import { useEffect, useState } from 'react';
import { getFunnelMetrics } from '@/lib/api';

export function useFunnelMetrics(start: Date, end: Date) {
  const [data, setData] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const s = start.toISOString();
        const e = end.toISOString();
        const res = await getFunnelMetrics(s, e);
        if (mounted) setData(res.totals || {});
      } catch (e: any) {
        if (mounted) setError(e?.message || 'error');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [start, end]);

  return { data, loading, error };
  
}

