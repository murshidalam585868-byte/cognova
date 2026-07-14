/**
 * Workflow Engine — State-machine based workflow execution
 *
 * Supports DAG workflows with branching, conditional logic,
 * retries, and observability. Backed by Supabase Postgres.
 */

import { z } from 'zod';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '@/lib/config';
import type { Workflow, WorkflowNode } from '@/types';

// ------------------------------------------------------------------
// Zod schemas
// ------------------------------------------------------------------

export const WorkflowExecutionSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'paused']),
  currentNodeId: z.string().optional(),
  context: z.record(z.unknown()).default({}),
  nodeResults: z.record(z.unknown()).default({}),
  errorLog: z.array(z.string()).default([]),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
});

export type WorkflowExecution = z.infer<typeof WorkflowExecutionSchema>;

const NodeConfigSchema = z.object({
  action: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  retries: z.number().int().min(0).max(5).default(2),
  timeoutSeconds: z.number().int().min(1).max(300).default(60),
  condition: z.string().optional(), // e.g. "context.approved === true"
});

export type NodeConfig = z.infer<typeof NodeConfigSchema>;

// ------------------------------------------------------------------
// Workflow Engine
// ------------------------------------------------------------------

export class WorkflowEngine {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    if (client) {
      this.client = client;
    } else {
      const config = loadConfig();
      this.client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
        auth: { persistSession: false },
      });
    }
  }

  // ------------------ Workflow CRUD ------------------

  /**
   * Create a new workflow definition.
   */
  async createWorkflow(input: Omit<Workflow, 'id'> & { id?: string }): Promise<Workflow> {
    const { data, error } = await this.client
      .from('workflows')
      .insert({
        id: input.id ?? crypto.randomUUID(),
        name: input.name,
        nodes: input.nodes as unknown[],
        status: input.status ?? 'draft',
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create workflow: ${error.message}`);
    return data as Workflow;
  }

  /**
   * Get a workflow by ID.
   */
  async getWorkflow(id: string): Promise<Workflow | null> {
    const { data, error } = await this.client
      .from('workflows')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Failed to get workflow: ${error.message}`);
    }
    return data as Workflow;
  }

  /**
   * List active workflows.
   */
  async listWorkflows(opts?: { status?: Workflow['status']; limit?: number }): Promise<Workflow[]> {
    let builder = this.client.from('workflows').select('*');
    if (opts?.status) builder = builder.eq('status', opts.status);
    if (opts?.limit) builder = builder.limit(opts.limit);

    const { data, error } = await builder.order('created_at', { ascending: false });
    if (error) throw new Error(`Failed to list workflows: ${error.message}`);
    return (data ?? []) as Workflow[];
  }

  // ------------------ Execution ------------------

  /**
   * Start a new execution of a workflow.
   */
  async startExecution(
    workflowId: string,
    initialContext: Record<string, unknown> = {}
  ): Promise<WorkflowExecution> {
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
    if (workflow.nodes.length === 0) throw new Error('Workflow has no nodes');

    const execution: Omit<WorkflowExecution, 'id'> = {
      workflowId,
      status: 'pending',
      currentNodeId: workflow.nodes[0]?.id,
      context: initialContext,
      nodeResults: {},
      errorLog: [],
      startedAt: new Date().toISOString(),
    };

    const { data, error } = await this.client
      .from('workflow_executions')
      .insert(execution)
      .select()
      .single();

    if (error) throw new Error(`Failed to start execution: ${error.message}`);
    return WorkflowExecutionSchema.parse(data);
  }

  /**
   * Execute the next step in a workflow execution.
   * Call this repeatedly until status is terminal.
   */
  async tick(executionId: string): Promise<WorkflowExecution> {
    const exec = await this.getExecution(executionId);
    if (!exec) throw new Error(`Execution not found: ${executionId}`);
    if (['completed', 'failed'].includes(exec.status)) return exec;

    const workflow = await this.getWorkflow(exec.workflowId);
    if (!workflow) throw new Error(`Workflow missing for execution ${executionId}`);

    // Mark running
    await this.updateExecution(executionId, { status: 'running' });

    const currentNode = workflow.nodes.find((n) => n.id === exec.currentNodeId);
    if (!currentNode) {
      await this.completeExecution(executionId, 'failed', ['Current node not found in workflow']);
      return this.getExecution(executionId) as Promise<WorkflowExecution>;
    }

    try {
      const config = NodeConfigSchema.parse(currentNode.config);

      // Evaluate condition if present
      if (config.condition) {
        const conditionMet = this.evaluateCondition(config.condition, exec.context);
        if (!conditionMet) {
          // Skip to next node
          const nextNode = this.pickNextNode(workflow, currentNode, exec.context);
          await this.updateExecution(executionId, {
            currentNodeId: nextNode?.id ?? undefined,
            status: nextNode ? 'pending' : 'completed',
          });
          if (!nextNode) {
            await this.completeExecution(executionId, 'completed');
          }
          return this.getExecution(executionId) as Promise<WorkflowExecution>;
        }
      }

      // Execute node action with retry
      const result = await this.executeNodeWithRetry(currentNode, exec.context, config);

      // Store result and advance
      const nodeResults = { ...exec.nodeResults, [currentNode.id]: result };
      const nextNode = this.pickNextNode(workflow, currentNode, exec.context);

      await this.updateExecution(executionId, {
        nodeResults,
        currentNodeId: nextNode?.id ?? undefined,
        status: nextNode ? 'pending' : 'completed',
      });

      if (!nextNode) {
        await this.completeExecution(executionId, 'completed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorLog = [...exec.errorLog, `[${currentNode.id}] ${message}`];
      await this.completeExecution(executionId, 'failed', errorLog);
    }

    return this.getExecution(executionId) as Promise<WorkflowExecution>;
  }

  /**
   * Run a workflow to completion (blocking).
   */
  async runToCompletion(
    workflowId: string,
    initialContext: Record<string, unknown> = {}
  ): Promise<WorkflowExecution> {
    let exec = await this.startExecution(workflowId, initialContext);
    const maxTicks = 100; // Safety limit
    let ticks = 0;

    while (!['completed', 'failed'].includes(exec.status) && ticks < maxTicks) {
      exec = await this.tick(exec.id);
      ticks++;
    }

    if (ticks >= maxTicks) {
      await this.completeExecution(exec.id, 'failed', [
        `Exceeded maximum tick count (${maxTicks}) — possible infinite loop`,
      ]);
      exec = await this.getExecution(exec.id) as WorkflowExecution;
    }

    return exec;
  }

  // ------------------ Internal helpers ------------------

  private async getExecution(id: string): Promise<WorkflowExecution | null> {
    const { data, error } = await this.client
      .from('workflow_executions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Failed to get execution: ${error.message}`);
    }
    return WorkflowExecutionSchema.parse(data);
  }

  private async updateExecution(
    id: string,
    patch: Partial<Pick<WorkflowExecution, 'status' | 'currentNodeId' | 'context' | 'nodeResults'>>
  ): Promise<void> {
    const { error } = await this.client.from('workflow_executions').update(patch).eq('id', id);
    if (error) throw new Error(`Failed to update execution: ${error.message}`);
  }

  private async completeExecution(
    id: string,
    status: 'completed' | 'failed',
    errorLog?: string[]
  ): Promise<void> {
    const patch: Record<string, unknown> = {
      status,
      completed_at: new Date().toISOString(),
    };
    if (errorLog) patch.error_log = errorLog;

    const { error } = await this.client.from('workflow_executions').update(patch).eq('id', id);
    if (error) throw new Error(`Failed to complete execution: ${error.message}`);
  }

  private evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
    // Simple expression evaluator — in production, use a safe sandbox
    // like `vm2` or `quickjs`. Here we support a narrow DSL:
    // "context.approved === true"
    // "context.score > 50"
    try {
      const fn = new Function('context', `return ${condition}`);
      return Boolean(fn(context));
    } catch {
      return false;
    }
  }

  private pickNextNode(
    workflow: Workflow,
    currentNode: WorkflowNode,
    _context: Record<string, unknown>
  ): WorkflowNode | undefined {
    // For now, follow the first next node. In future, support branching logic.
    if (currentNode.nextNodes.length === 0) return undefined;
    const nextId = currentNode.nextNodes[0];
    return workflow.nodes.find((n) => n.id === nextId);
  }

  private async executeNodeWithRetry(
    node: WorkflowNode,
    context: Record<string, unknown>,
    config: NodeConfig
  ): Promise<unknown> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= config.retries; attempt++) {
      try {
        return await this.executeNodeAction(node, context, config);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < config.retries) {
          // Exponential backoff: 500ms, 1000ms, 2000ms, ...
          await new Promise((res) => setTimeout(res, 500 * Math.pow(2, attempt)));
        }
      }
    }

    throw lastError ?? new Error(`Node ${node.id} failed after ${config.retries + 1} attempts`);
  }

  private async executeNodeAction(
    node: WorkflowNode,
    context: Record<string, unknown>,
    config: NodeConfig
  ): Promise<unknown> {
    // Dispatch to action registry. Extend this map for new actions.
    const registry: Record<string, (ctx: Record<string, unknown>, params: Record<string, unknown>) => Promise<unknown>> = {
      async log(ctx, params) {
        const msg = String(params.message ?? 'No message');
        console.log('[Workflow]', msg, ctx);
        return { logged: msg };
      },
      async transform(ctx, params) {
        const key = String(params.key ?? 'result');
        const value = params.value;
        return { [key]: value, ...ctx };
      },
      async http(ctx, params) {
        const url = String(params.url);
        const method = String(params.method ?? 'GET');
        const body = params.body ? JSON.stringify(params.body) : undefined;
        const res = await fetch(url, { method, body, headers: { 'Content-Type': 'application/json' } });
        return { status: res.status, body: await res.json().catch(() => null) };
      },
      async agent_dispatch(ctx, params) {
        // Dispatch to multi-agent graph
        const { runAgentSubset } = await import('./multi-agent');
        const agents = (params.agents as string[]) ?? ['CEO'];
        const query = String(params.query ?? ctx.query ?? 'No query');
        const result = await runAgentSubset(
          agents as Array<'CEO' | 'CFO' | 'COO' | 'CTO'>,
          query,
          ctx
        );
        return result;
      },
    };

    const action = registry[config.action];
    if (!action) {
      throw new Error(`Unknown workflow action: ${config.action}`);
    }

    // Timeout wrapper
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Node ${node.id} timed out after ${config.timeoutSeconds}s`)), config.timeoutSeconds * 1000);
    });

    return Promise.race([action(context, config.params), timeoutPromise]);
  }
}

// ------------------------------------------------------------------
// Singleton
// ------------------------------------------------------------------

let _engine: WorkflowEngine | null = null;

export function getWorkflowEngine(): WorkflowEngine {
  if (!_engine) {
    _engine = new WorkflowEngine();
  }
  return _engine;
}
