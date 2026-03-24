import { useState, useEffect } from 'react';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';

function DateTimePage() {
  const [data, setData]     = useState(null);
  const [error, setError]   = useState(null);
  const [loading, setLoading] = useState(true);
  const getIcon = useIcon();

  const fetchTime = () => {
    setLoading(true);
    api.get('/api/tools/datetime')
      .then(async res => {
        if (res.status === 403) { setError('access_denied'); return; }
        if (!res.ok)            { setError('error'); return; }
        setData(await res.json());
        setError(null);
      })
      .catch(() => setError('error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchTime(); }, []);

  if (loading) {
    return (
      <div className="p-6 flex justify-center py-16">
        <div className="flex gap-1.5">
          {[0, 150, 300].map(delay => (
            <span
              key={delay}
              className="w-2 h-2 rounded-full animate-bounce"
              style={{ background: 'var(--color-primary)', animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error === 'access_denied') {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <div
          className="rounded-2xl border p-10 text-center"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="flex justify-center mb-3" style={{ color: 'var(--color-border)' }}>
            {getIcon('lock', { size: 32 })}
          </div>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
            Access Denied
          </p>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            You do not have permission to access this tool. Contact your admin.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <p className="text-sm" style={{ color: '#ef4444' }}>Failed to load data. Please try again.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Date & Time</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {data?.accessLevel === 'extended' ? 'Extended view' : 'Basic view'}
          </p>
        </div>
        <button
          onClick={fetchTime}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:opacity-60 transition-opacity"
          style={{ color: 'var(--color-muted)' }}
          title="Refresh"
        >
          {getIcon('refresh-cw', { size: 15 })}
        </button>
      </div>

      <div
        className="rounded-2xl border p-6 space-y-5"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <InfoRow label="Date" value={data?.date} />
        <InfoRow label="Time" value={data?.time} />

        {data?.accessLevel === 'extended' && (
          <div className="space-y-5 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
            <InfoRow label="Timezone"        value={data?.timezone} />
            <InfoRow
              label="UTC Offset"
              value={data?.utcOffset >= 0 ? `+${data.utcOffset}` : String(data.utcOffset)}
            />
            <InfoRow label="Server Location" value={data?.serverLocation} />
          </div>
        )}
      </div>

      <p className="text-xs mt-3 text-right font-mono" style={{ color: 'var(--color-muted)' }}>
        {data?.iso}
      </p>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div>
      <p
        className="text-xs font-semibold uppercase tracking-wider mb-1"
        style={{ color: 'var(--color-muted)' }}
      >
        {label}
      </p>
      <p className="text-lg font-medium" style={{ color: 'var(--color-text)' }}>
        {value}
      </p>
    </div>
  );
}

export default DateTimePage;
