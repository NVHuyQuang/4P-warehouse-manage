import { supabase } from '@/lib/supabase/client';

export interface DispatchOptions<T> {
  actionName: string;
  storeId?: string;
  payload?: unknown;
  execute: () => Promise<T>;
  onSuccess?: (data: T) => void;
  onError?: (err: Error) => void;
}

export interface DispatchResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  retry?: () => Promise<DispatchResult<T>>;
}

/**
 * Client Action Dispatcher (Rule 6)
 * - Single point of entry for all frontline writes (browser -> Supabase RPC)
 * - Prohibits infinite auto-retry
 * - Logs failed actions once to audit/security logs
 * - Preserves seam for future offline IndexedDB queueing
 */
export async function dispatchAction<T>(options: DispatchOptions<T>): Promise<DispatchResult<T>> {
  const { actionName, execute, onSuccess, onError } = options;

  try {
    const data = await execute();
    if (onSuccess) {
      onSuccess(data);
    }
    return {
      success: true,
      data,
    };
  } catch (err: unknown) {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    const errorMessage = errorObj.message;

    // Log failure once to t_security_logs asynchronously without blocking UI
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (userId) {
        await supabase.from('t_security_logs').insert({
          user_id: userId,
          event_type: 'FAILED_ACTION',
          device_info: `Client Dispatch: ${actionName} - ${errorMessage.slice(0, 150)}`,
        });
      }
    } catch {
      // Diagnostic logging failure must never mask original error
    }

    if (onError) {
      onError(errorObj);
    }

    // Return structured failure with explicit manual retry closure
    return {
      success: false,
      error: errorMessage,
      retry: () => dispatchAction(options),
    };
  }
}
