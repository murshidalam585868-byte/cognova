/**
 * Knowledge Graph — Postgres-backed entity-relationship store
 *
 * Stores entities, relations, and triples (subject-predicate-object)
 * in Supabase Postgres. Supports CRUD, graph traversal, and
 * semantic search via pg_trgm.
 */

import { z } from 'zod';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '@/lib/config';
import type { Entity, Relation } from '@/types';

// ------------------------------------------------------------------
// Zod schemas for knowledge graph operations
// ------------------------------------------------------------------

export const TripleSchema = z.object({
  id: z.string().uuid(),
  subjectId: z.string().uuid(),
  predicate: z.string().min(1),
  objectId: z.string().uuid(),
  properties: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
});

export type Triple = z.infer<typeof TripleSchema>;

export const EntityInputSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.string().min(1).max(100),
  properties: z.record(z.unknown()).default({}),
});

export type EntityInput = z.infer<typeof EntityInputSchema>;

export const RelationInputSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  type: z.string().min(1).max(100),
  properties: z.record(z.unknown()).default({}),
});

export type RelationInput = z.infer<typeof RelationInputSchema>;

// ------------------------------------------------------------------
// Knowledge Graph Client
// ------------------------------------------------------------------

export class KnowledgeGraph {
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

  // ------------------ Entities ------------------

  /**
   * Create a new entity in the knowledge graph.
   */
  async createEntity(input: EntityInput): Promise<Entity> {
    const validated = EntityInputSchema.parse(input);
    const { data, error } = await this.client
      .from('kg_entities')
      .insert({
        name: validated.name,
        type: validated.type,
        properties: validated.properties,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create entity: ${error.message}`);
    return data as Entity;
  }

  /**
   * Retrieve an entity by ID.
   */
  async getEntity(id: string): Promise<Entity | null> {
    const { data, error } = await this.client
      .from('kg_entities')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // not found
      throw new Error(`Failed to get entity: ${error.message}`);
    }
    return data as Entity;
  }

  /**
   * Search entities by name (fuzzy) or type (exact).
   */
  async searchEntities(opts: {
    query?: string;
    type?: string;
    limit?: number;
  }): Promise<Entity[]> {
    const limit = opts.limit ?? 20;
    let builder = this.client
      .from('kg_entities')
      .select('*')
      .limit(limit);

    if (opts.type) {
      builder = builder.eq('type', opts.type);
    }

    if (opts.query) {
      // Use pg_trgm similarity if available, else ILIKE fallback
      builder = builder.ilike('name', `%${opts.query}%`);
    }

    const { data, error } = await builder.order('name', { ascending: true });
    if (error) throw new Error(`Failed to search entities: ${error.message}`);
    return (data ?? []) as Entity[];
  }

  /**
   * Update an entity's properties.
   */
  async updateEntity(
    id: string,
    patch: Partial<Pick<Entity, 'name' | 'type' | 'properties'>>
  ): Promise<Entity> {
    const { data, error } = await this.client
      .from('kg_entities')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update entity: ${error.message}`);
    return data as Entity;
  }

  /**
   * Delete an entity and all its relations.
   */
  async deleteEntity(id: string): Promise<void> {
    // Relations with cascade should auto-delete, but we ensure cleanliness
    await this.client.from('kg_relations').delete().or(`source_id.eq.${id},target_id.eq.${id}`);
    await this.client.from('kg_triples').delete().or(`subject_id.eq.${id},object_id.eq.${id}`);

    const { error } = await this.client.from('kg_entities').delete().eq('id', id);
    if (error) throw new Error(`Failed to delete entity: ${error.message}`);
  }

  // ------------------ Relations ------------------

  /**
   * Create a relation between two entities.
   */
  async createRelation(input: RelationInput): Promise<Relation> {
    const validated = RelationInputSchema.parse(input);
    const { data, error } = await this.client
      .from('kg_relations')
      .insert({
        source_id: validated.sourceId,
        target_id: validated.targetId,
        type: validated.type,
        properties: validated.properties,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create relation: ${error.message}`);
    return data as Relation;
  }

  /**
   * Get all relations for an entity (both incoming and outgoing).
   */
  async getEntityRelations(entityId: string): Promise<Relation[]> {
    const { data, error } = await this.client
      .from('kg_relations')
      .select('*')
      .or(`source_id.eq.${entityId},target_id.eq.${entityId}`);

    if (error) throw new Error(`Failed to get relations: ${error.message}`);
    return (data ?? []) as Relation[];
  }

  /**
   * Delete a relation by ID.
   */
  async deleteRelation(id: string): Promise<void> {
    const { error } = await this.client.from('kg_relations').delete().eq('id', id);
    if (error) throw new Error(`Failed to delete relation: ${error.message}`);
  }

  // ------------------ Triples ------------------

  /**
   * Create a triple (subject-predicate-object).
   * Triples provide a canonical semantic representation of the graph.
   */
  async createTriple(input: Omit<Triple, 'id' | 'createdAt'> & { id?: string }): Promise<Triple> {
    const payload = {
      id: input.id ?? crypto.randomUUID(),
      subject_id: input.subjectId,
      predicate: input.predicate,
      object_id: input.objectId,
      properties: input.properties ?? {},
      created_at: new Date().toISOString(),
    };

    const { data, error } = await this.client
      .from('kg_triples')
      .insert(payload)
      .select()
      .single();

    if (error) throw new Error(`Failed to create triple: ${error.message}`);
    return TripleSchema.parse(data);
  }

  /**
   * Query triples by subject, predicate, or object.
   */
  async queryTriples(opts: {
    subjectId?: string;
    predicate?: string;
    objectId?: string;
    limit?: number;
  }): Promise<Triple[]> {
    const limit = opts.limit ?? 50;
    let builder = this.client.from('kg_triples').select('*').limit(limit);

    if (opts.subjectId) builder = builder.eq('subject_id', opts.subjectId);
    if (opts.predicate) builder = builder.eq('predicate', opts.predicate);
    if (opts.objectId) builder = builder.eq('object_id', opts.objectId);

    const { data, error } = await builder.order('created_at', { ascending: false });
    if (error) throw new Error(`Failed to query triples: ${error.message}`);
    return (data ?? []).map((row) => TripleSchema.parse(row));
  }

  // ------------------ Graph Traversal ------------------

  /**
   * BFS traversal from a starting entity up to a given depth.
   * Returns nodes and edges in the explored subgraph.
   */
  async traverse(
    startEntityId: string,
    maxDepth: number = 2
  ): Promise<{ entities: Entity[]; relations: Relation[] }> {
    const visited = new Set<string>();
    const entities: Entity[] = [];
    const relations: Relation[] = [];
    let frontier = [startEntityId];
    let depth = 0;

    while (frontier.length > 0 && depth < maxDepth) {
      const nextFrontier: string[] = [];

      for (const id of frontier) {
        if (visited.has(id)) continue;
        visited.add(id);

        const entity = await this.getEntity(id);
        if (entity) entities.push(entity);

        const rels = await this.getEntityRelations(id);
        for (const rel of rels) {
          relations.push(rel);
          const neighbor = rel.sourceId === id ? rel.targetId : rel.sourceId;
          if (!visited.has(neighbor)) {
            nextFrontier.push(neighbor);
          }
        }
      }

      frontier = nextFrontier;
      depth++;
    }

    return { entities, relations };
  }

  // ------------------ Batch Import ------------------

  /**
   * Bulk import entities and relations from a structured payload.
   * Useful for ingesting external knowledge bases.
   */
  async bulkImport(payload: {
    entities: EntityInput[];
    relations: RelationInput[];
  }): Promise<{ entityCount: number; relationCount: number }> {
    // Insert entities
    const entityRows = payload.entities.map((e) => EntityInputSchema.parse(e));
    const { data: insertedEntities, error: entityError } = await this.client
      .from('kg_entities')
      .insert(entityRows)
      .select();

    if (entityError) throw new Error(`Bulk entity insert failed: ${entityError.message}`);

    // Build a name→id map for relation resolution
    const nameToId = new Map<string, string>();
    for (const ent of (insertedEntities ?? []) as Entity[]) {
      nameToId.set(ent.name, ent.id);
    }

    // Resolve and insert relations
    const relationRows = payload.relations
      .map((r) => {
        const validated = RelationInputSchema.parse(r);
        return validated;
      })
      .filter((r) => nameToId.has(r.sourceId) && nameToId.has(r.targetId));

    const { error: relError } = await this.client
      .from('kg_relations')
      .insert(relationRows);

    if (relError) throw new Error(`Bulk relation insert failed: ${relError.message}`);

    return {
      entityCount: insertedEntities?.length ?? 0,
      relationCount: relationRows.length,
    };
  }
}

// ------------------------------------------------------------------
// Singleton instance
// ------------------------------------------------------------------

let _kg: KnowledgeGraph | null = null;

export function getKnowledgeGraph(): KnowledgeGraph {
  if (!_kg) {
    _kg = new KnowledgeGraph();
  }
  return _kg;
}
