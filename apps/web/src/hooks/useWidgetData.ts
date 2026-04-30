import { useState, useEffect } from 'react';
import { WidgetType } from '@ecoledigitale/contracts';

interface UseWidgetDataOptions {
  refreshInterval?: number;
  period?: string;
}

export function useWidgetData(
  widgetType: WidgetType | 'available-widgets',
  options: UseWidgetDataOptions = {}
) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { refreshInterval = 30000, period } = options;

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      let url = `/api/v1/students/dashboards/widgets/${widgetType}/data`;
      if (widgetType === 'available-widgets') {
        url = '/api/v1/students/dashboards/available-widgets';
      }

      const params = new URLSearchParams();
      if (period) {
        params.append('period', period);
      }

      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Erreur HTTP: ${response.status}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    if (refreshInterval > 0) {
      const interval = setInterval(fetchData, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [widgetType, period, refreshInterval]);

  return { data, loading, error, refetch: fetchData };
}


