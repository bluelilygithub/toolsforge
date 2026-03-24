import { useEffect, useState, useCallback, useRef } from 'react';
import { useIcon } from '../providers/IconProvider';
import { useToast } from '../components/Toast';
import api from '../utils/apiClient';

function EditModal({ template, onClose, onSaved }) {
  const [subject, setSubject]     = useState(template.subject || '');
  const [bodyHtml, setBodyHtml]   = useState(template.body_html || '');
  const [bodyText, setBodyText]   = useState(template.body_text || '');
  const [tab, setTab]             = useState('html');
  const [saving, setSaving]       = useState(false);
  const [resetting, setResetting] = useState(false);
  const showToast = useToast();
  const getIcon = useIcon();

  // Track which field last had focus + cursor position
  const lastFocus = useRef({ field: 'bodyHtml', start: 0, end: 0 });
  const subjectRef  = useRef(null);
  const textareaRef = useRef(null);

  const recordCursor = (field, el) => {
    lastFocus.current = { field, start: el.selectionStart, end: el.selectionEnd };
  };

  const insertVariable = (varName) => {
    const token = `{{${varName}}}`;
    const { field, start, end } = lastFocus.current;

    if (field === 'subject') {
      const next = subject.slice(0, start) + token + subject.slice(end);
      setSubject(next);
      // Restore cursor after inserted token
      requestAnimationFrame(() => {
        if (subjectRef.current) {
          subjectRef.current.focus();
          subjectRef.current.setSelectionRange(start + token.length, start + token.length);
        }
      });
    } else if (field === 'bodyHtml') {
      const next = bodyHtml.slice(0, start) + token + bodyHtml.slice(end);
      setBodyHtml(next);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(start + token.length, start + token.length);
        }
      });
    } else {
      const next = bodyText.slice(0, start) + token + bodyText.slice(end);
      setBodyText(next);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(start + token.length, start + token.length);
        }
      });
    }
    lastFocus.current = { ...lastFocus.current, start: lastFocus.current.start + token.length, end: lastFocus.current.start + token.length };
  };

  const save = async () => {
    if (!subject.trim() || !bodyHtml.trim() || !bodyText.trim()) {
      showToast('All fields are required', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.put(`/api/admin/email-templates/${template.slug}`, {
        subject, body_html: bodyHtml, body_text: bodyText,
      });
      showToast('Template saved');
      onSaved();
    } catch {
      showToast('Failed to save template', 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm('Reset this template to its default content? Your customisations will be lost.')) return;
    setResetting(true);
    try {
      await api.post(`/api/admin/email-templates/${template.slug}/reset`, {});
      showToast('Template reset to default');
      onSaved();
    } catch (err) {
      showToast('Failed to reset template', 'error');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: 'var(--color-surface)',
          borderRadius: 16,
          border: '1px solid var(--color-border)',
          width: '100%',
          maxWidth: 700,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '20px 24px 16px',
            borderBottom: '1px solid var(--color-border)',
            flexShrink: 0,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>
              Edit Template
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-muted)', fontFamily: 'monospace' }}>
              {template.slug}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', padding: 4 }}
          >
            {getIcon('x', { size: 18 })}
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {/* Variables hint — click to insert */}
          {template.variables?.length > 0 && (
            <div
              style={{
                background: 'rgba(var(--color-primary-rgb),0.05)',
                border: '1px solid rgba(var(--color-primary-rgb),0.15)',
                borderRadius: 10,
                padding: '10px 14px',
                marginBottom: 16,
              }}
            >
              <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>
                Click a variable to insert it at the cursor
              </p>
              <div>
                {template.variables.map(v => (
                  <button
                    key={v}
                    onMouseDown={e => { e.preventDefault(); insertVariable(v); }}
                    style={{
                      display: 'inline-block',
                      background: 'rgba(var(--color-primary-rgb),0.08)',
                      color: 'var(--color-primary)',
                      borderRadius: 6,
                      fontSize: 11,
                      fontFamily: 'monospace',
                      padding: '2px 8px',
                      marginRight: 4,
                      marginBottom: 2,
                      border: '1px solid rgba(var(--color-primary-rgb),0.2)',
                      cursor: 'pointer',
                    }}
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Subject */}
          <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>
            Subject
          </label>
          <input
            ref={subjectRef}
            value={subject}
            onChange={e => setSubject(e.target.value)}
            onSelect={e => recordCursor('subject', e.target)}
            onFocus={e => recordCursor('subject', e.target)}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '8px 12px',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              fontSize: 13,
              marginBottom: 16,
            }}
          />

          {/* Body tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
            {['html', 'preview', 'text'].map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '5px 14px',
                  borderRadius: 8,
                  border: '1px solid var(--color-border)',
                  background: tab === t ? 'var(--color-primary)' : 'var(--color-bg)',
                  color: tab === t ? '#fff' : 'var(--color-muted)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {t === 'html' ? 'HTML Source' : t === 'preview' ? 'Preview' : 'Plain Text'}
              </button>
            ))}
            {tab === 'text' && (
              <button
                onMouseDown={e => {
                  e.preventDefault();
                  // Strip HTML tags to generate plain text from HTML body
                  const stripped = bodyHtml
                    .replace(/<style[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/&nbsp;/g, ' ')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/[ \t]+/g, ' ')
                    .replace(/\n{3,}/g, '\n\n')
                    .trim();
                  setBodyText(stripped);
                }}
                style={{
                  padding: '5px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--color-border)',
                  background: 'transparent',
                  color: 'var(--color-muted)',
                  fontSize: 11,
                  cursor: 'pointer',
                  marginLeft: 4,
                }}
              >
                Auto-generate from HTML
              </button>
            )}
            <span style={{ fontSize: 11, color: 'var(--color-muted)', marginLeft: 4 }}>
              {tab === 'html' && 'Edit raw HTML — this is what email clients display'}
              {tab === 'preview' && 'Rendered preview — {{variables}} shown unsubstituted'}
              {tab === 'text' && 'Fallback for clients that cannot render HTML (rare)'}
            </span>
          </div>

          {tab === 'preview' ? (
            <iframe
              srcDoc={bodyHtml}
              sandbox="allow-same-origin"
              style={{
                width: '100%',
                height: 480,
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                background: '#fff',
              }}
              title="Email preview"
            />
          ) : (
          <textarea
            ref={textareaRef}
            value={tab === 'text' ? bodyText : bodyHtml}
            onChange={e => tab === 'text' ? setBodyText(e.target.value) : setBodyHtml(e.target.value)}
            onSelect={e => recordCursor(tab === 'text' ? 'bodyText' : 'bodyHtml', e.target)}
            onFocus={e => recordCursor(tab === 'text' ? 'bodyText' : 'bodyHtml', e.target)}
            rows={16}
            spellCheck={false}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '10px 12px',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              fontSize: 12,
              fontFamily: 'monospace',
              lineHeight: 1.6,
              resize: 'vertical',
            }}
          />
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '14px 24px',
            borderTop: '1px solid var(--color-border)',
            flexShrink: 0,
          }}
        >
          <button
            onClick={reset}
            disabled={resetting}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid var(--color-border)',
              background: 'transparent',
              color: 'var(--color-muted)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {resetting ? 'Resetting…' : 'Reset to default'}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                background: 'transparent',
                color: 'var(--color-text)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              style={{
                padding: '8px 20px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--color-primary)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminEmailTemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [editing, setEditing]     = useState(null);
  const showToast = useToast();
  const getIcon = useIcon();

  const fetchTemplates = useCallback(() => {
    api.get('/api/admin/email-templates')
      .then(r => r.json())
      .then(data => setTemplates(data))
      .catch(() => showToast('Failed to load templates', 'error'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const openEdit = async (slug) => {
    try {
      const r = await api.get(`/api/admin/email-templates/${slug}`);
      const tmpl = await r.json();
      setEditing(tmpl);
    } catch {
      showToast('Failed to load template', 'error');
    }
  };

  const onSaved = () => {
    setEditing(null);
    fetchTemplates();
  };

  // Group by tool_slug (null = platform templates)
  const groups = templates.reduce((acc, t) => {
    const key = t.tool_slug || '__platform__';
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});

  const groupOrder = ['__platform__', ...Object.keys(groups).filter(k => k !== '__platform__')];

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: 'var(--color-text)' }}>
        Email Templates
      </h1>
      <p style={{ margin: '0 0 28px', fontSize: 14, color: 'var(--color-muted)' }}>
        Customise the subject and body of automated emails. Use{' '}
        <code style={{ fontFamily: 'monospace', fontSize: 12 }}>{'{{variable}}'}</code>{' '}
        placeholders where applicable.
      </p>

      {loading ? (
        <p style={{ color: 'var(--color-muted)', fontSize: 14 }}>Loading…</p>
      ) : templates.length === 0 ? (
        <p style={{ color: 'var(--color-muted)', fontSize: 14 }}>No templates found.</p>
      ) : (
        groupOrder.filter(g => groups[g]).map(group => (
          <div key={group} style={{ marginBottom: 28 }}>
            <p
              style={{
                margin: '0 0 10px',
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--color-muted)',
              }}
            >
              {group === '__platform__' ? 'Platform' : group}
            </p>

            <div
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              {groups[group].map((t, i) => (
                <div
                  key={t.slug}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 16px',
                    borderTop: i > 0 ? '1px solid var(--color-border)' : 'none',
                    background: 'var(--color-surface)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
                        {t.subject}
                      </span>
                    </div>
                    {t.description && (
                      <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-muted)' }}>
                        {t.description}
                      </p>
                    )}
                    {t.variables?.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        {t.variables.map(v => (
                          <span
                            key={v}
                            style={{
                              display: 'inline-block',
                              background: 'rgba(var(--color-primary-rgb),0.08)',
                              color: 'var(--color-primary)',
                              borderRadius: 6,
                              fontSize: 11,
                              fontFamily: 'monospace',
                              padding: '1px 7px',
                              marginRight: 4,
                              marginBottom: 2,
                            }}
                          >
                            {`{{${v}}}`}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => openEdit(t.slug)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 14px',
                      borderRadius: 8,
                      border: '1px solid var(--color-border)',
                      background: 'transparent',
                      color: 'var(--color-text)',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      flexShrink: 0,
                      marginLeft: 16,
                    }}
                  >
                    {getIcon('pencil', { size: 13 })}
                    Edit
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {editing && (
        <EditModal
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

export default AdminEmailTemplatesPage;
