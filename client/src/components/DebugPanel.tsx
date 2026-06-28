import { useState } from 'react';
import { useDebugStore, type DebugLog } from '../store/debugStore';

function LogEntry({ log }: { log: DebugLog }) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false });

  const typeColors: Record<DebugLog['type'], string> = {
    request: 'text-blue-400 bg-blue-950',
    response: 'text-green-400 bg-green-950',
    error: 'text-red-400 bg-red-950',
    ui_action: 'text-yellow-400 bg-yellow-950',
  };

  const labelMap: Record<DebugLog['type'], string> = {
    request: '→ REQ',
    response: '← RES',
    error: '✗ ERR',
    ui_action: '⚡ ACT',
  };
  const label = labelMap[log.type] || log.type;

  return (
    <div className="border-b border-gray-800 last:border-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-2 hover:bg-gray-800 transition-colors flex items-center gap-2 text-xs"
      >
        <span className="text-gray-500 font-mono w-20 shrink-0">{time}</span>
        <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] font-mono ${typeColors[log.type] || 'text-gray-400'}`}>
          {label}
        </span>
        <span className="font-mono text-gray-300 truncate">
          {log.method && <span className="text-purple-400 mr-1">{log.method}</span>}
          {log.url || log.message || ''}
        </span>
        <span className={`ml-auto text-gray-600 transition-transform ${expanded ? 'rotate-90' : ''}`}>›</span>
      </button>

      {expanded && (
        <div className="bg-gray-950 px-3 pb-3 space-y-2">
          {log.payload !== undefined && (
            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Payload</p>
              <pre className="text-[11px] text-green-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
                {JSON.stringify(log.payload, null, 2)}
              </pre>
            </div>
          )}
          {log.debug !== undefined && (
            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Debug Envelope</p>
              <pre className="text-[11px] text-yellow-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
                {JSON.stringify(log.debug, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DebugPanel() {
  const { isDebugMode, logs, toggleDebugMode, clearLogs } = useDebugStore();
  const [minimized, setMinimized] = useState(false);

  if (!isDebugMode && !minimized) {
    // Render only the toggle button when debug mode is off
    return (
      <button
        onClick={toggleDebugMode}
        title="Enable Debug Mode"
        className="fixed bottom-4 right-4 z-50 w-8 h-8 rounded-full bg-gray-900 border border-gray-700 flex items-center justify-center text-gray-500 hover:text-yellow-400 hover:border-yellow-600 transition-colors shadow-lg text-xs font-mono"
      >
        D
      </button>
    );
  }

  return (
    <div
      className={`fixed bottom-0 right-4 z-50 w-[520px] bg-gray-900 border border-gray-700 rounded-t-xl shadow-2xl shadow-black/60 font-mono overflow-hidden transition-all duration-200 ${
        minimized ? 'h-10' : 'h-[420px]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700 select-none">
        <div className="flex gap-1.5">
          <button
            onClick={toggleDebugMode}
            className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition-colors"
            title="Disable Debug Panel"
          />
          <button
            onClick={() => setMinimized(!minimized)}
            className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-400 transition-colors"
            title={minimized ? 'Expand' : 'Minimize'}
          />
          <button
            onClick={clearLogs}
            className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-400 transition-colors"
            title="Clear Logs"
          />
        </div>
        <span className="text-[11px] text-gray-400 ml-1">
          TradeMirror Debug Console
        </span>
        <span className="ml-auto text-[10px] text-gray-600">
          {logs.length} log{logs.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Log list */}
      {!minimized && (
        <div className="overflow-y-auto h-[calc(100%-40px)]">
          {logs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-xs">
              No logs yet. Make an API request to see activity.
            </div>
          ) : (
            logs.map((log) => <LogEntry key={log.id} log={log} />)
          )}
        </div>
      )}
    </div>
  );
}
