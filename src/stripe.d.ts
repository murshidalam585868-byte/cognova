declare module 'stripe' {
  namespace Stripe {
    interface Event {
      id: string;
      type: string;
      data: { object: unknown };
    }
    namespace Checkout {
      interface Session {
        id: string;
        metadata?: Record<string, string>;
        customer?: string;
        subscription?: string;
      }
    }
    interface Invoice {
      id: string;
      customer?: string;
      subscription?: string | null;
      charge?: string | null;
      currency: string;
      amount_due: number;
      amount_paid: number;
      amount_remaining?: number;
      invoice_pdf?: string;
      number?: string;
      description?: string;
      period_start?: number;
      period_end?: number;
      due_date?: number;
    }
    interface Subscription {
      id: string;
      customer: string;
      status: string;
      metadata?: Record<string, string>;
      items: { data: Array<{ price: { id: string; product: string } }> };
      cancel_at_period_end: boolean;
      current_period_start: number;
      current_period_end: number;
      trial_start?: number | null;
      trial_end?: number | null;
      canceled_at?: number | null;
      ended_at?: number | null;
    }
    interface Customer {
      metadata?: Record<string, string>;
    }
  }
  export = Stripe;
}
