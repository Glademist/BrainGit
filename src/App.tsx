import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Folder, 
  ChevronRight, 
  ChevronDown, 
  Plus, 
  MoreVertical, 
  Trash2, 
  Edit2,
  Clock,
  Save,
  Bell,
  Split,
  Eye,
  ArrowLeft,
  Check,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { formatDistanceToNow } from 'date-fns';
import { diffLines } from 'diff';

// --- Types ---
interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

interface Commit {
  oid: string;
  message: string;
  timestamp: number;
  author: string;
}

// --- Components ---

const Login = ({ onLogin }: { onLogin: () => void }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (res.ok) {
      onLogin();
    } else {
      setError('Invalid password');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-vscode-bg">
      <div className="w-full max-w-md p-8 space-y-8">
        <h1 className="text-4xl font-bold text-center text-vscode-text-bright tracking-tight">BrainGit</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            autoFocus
            autoComplete="new-password"
            placeholder="Enter password"
            className="w-full px-4 py-3 bg-vscode-sidebar border border-vscode-border rounded-md text-vscode-text-bright focus:outline-none focus:border-vscode-accent text-lg"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            className="w-full py-3 bg-vscode-accent hover:bg-opacity-90 text-white rounded-md font-medium transition-colors"
          >
            Log in
          </button>
        </form>
      </div>
    </div>
  );
};

interface FileTreeItemProps {
  node: FileNode;
  level: number;
  onSelect: (node: FileNode) => void;
  selectedPath: string | null;
  onAction: (action: string, node: FileNode) => void;
  key?: string | number;
}

const FileTreeItem = ({ 
  node, 
  level, 
  onSelect, 
  selectedPath,
  onAction
}: FileTreeItemProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const isSelected = selectedPath === node.path;

  return (
    <div>
      <div 
        className={`flex items-center py-1 px-2 cursor-pointer hover:bg-vscode-active group ${isSelected ? 'bg-vscode-active text-vscode-text-bright' : ''}`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => {
          if (node.type === 'directory') setIsOpen(!isOpen);
          else onSelect(node);
        }}
      >
        <span className="mr-1">
          {node.type === 'directory' ? (
            isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />
          ) : (
            <FileText size={16} className="text-vscode-text opacity-70" />
          )}
        </span>
        {node.type === 'directory' && <Folder size={16} className="mr-2 text-vscode-accent opacity-80" />}
        <span className="flex-1 truncate text-sm">{node.name}</span>
        <div className="hidden group-hover:flex items-center space-x-1">
          <button onClick={(e) => { e.stopPropagation(); onAction('delete', node); }} className="p-1 hover:bg-vscode-border rounded">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {node.type === 'directory' && isOpen && node.children?.map(child => (
        <FileTreeItem 
          key={child.path} 
          node={child} 
          level={level + 1} 
          onSelect={onSelect} 
          selectedPath={selectedPath}
          onAction={onAction}
        />
      ))}
    </div>
  );
};

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [history, setHistory] = useState<Commit[]>([]);
  const [diffMode, setDiffMode] = useState<{ active: boolean; oldContent?: string; commit?: Commit }>({ active: false });
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (authenticated) {
      fetchFiles();
    }
  }, [authenticated]);

  useEffect(() => {
    if (selectedFile) {
      fetchFileContent(selectedFile.path);
      fetchHistory(selectedFile.path);
    }
  }, [selectedFile]);

  const checkAuth = async () => {
    const res = await fetch('/api/auth/check');
    const data = await res.json();
    setAuthenticated(data.authenticated);
    setAuthChecked(true);
  };

  const fetchFiles = async () => {
    const res = await fetch('/api/files');
    const data = await res.json();
    setFiles(data);
  };

  const fetchFileContent = async (path: string) => {
    const res = await fetch(`/api/files/content?filePath=${encodeURIComponent(path)}`);
    const data = await res.json();
    setContent(data.content);
    setOriginalContent(data.content);
    setIsDirty(false);
    setDiffMode({ active: false });
  };

  const fetchHistory = async (path: string) => {
    const res = await fetch(`/api/git/history?filePath=${encodeURIComponent(path)}`);
    const data = await res.json();
    setHistory(data);
  };

  const handleSave = async () => {
    if (!selectedFile) return;
    const res = await fetch('/api/files/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: selectedFile.path, content })
    });
    if (res.ok) {
      setOriginalContent(content);
      setIsDirty(false);
    }
  };

  const handleNewSnapshot = async () => {
    const message = prompt("Snapshot message (optional):") || "Manual snapshot";
    const res = await fetch('/api/git/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    if (res.ok) {
      if (selectedFile) fetchHistory(selectedFile.path);
    }
  };

  const handleCreate = async (type: 'file' | 'directory') => {
    const name = prompt(`Enter ${type} name:`);
    if (!name) return;
    const res = await fetch('/api/files/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type })
    });
    if (res.ok) fetchFiles();
  };

  const handleDelete = async (node: FileNode) => {
    if (!confirm(`Delete ${node.name}?`)) return;
    const res = await fetch('/api/files/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: node.path })
    });
    if (res.ok) {
      fetchFiles();
      if (selectedFile?.path === node.path) {
        setSelectedFile(null);
        setContent('');
      }
    }
  };

  const viewHistoryVersion = async (commit: Commit) => {
    if (!selectedFile) return;
    const res = await fetch(`/api/git/show?oid=${commit.oid}&filePath=${encodeURIComponent(selectedFile.path)}`);
    const data = await res.json();
    setDiffMode({ active: true, oldContent: data.content, commit });
  };

  const restoreVersion = () => {
    if (diffMode.oldContent !== undefined) {
      setContent(diffMode.oldContent);
      setIsDirty(true);
      setDiffMode({ active: false });
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        handleNewSnapshot();
      }
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        handleCreate('file');
      }
      if (e.key === 'Escape' && diffMode.active) {
        setDiffMode({ active: false });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFile, content, diffMode]);

  if (!authChecked) return null;
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;

  return (
    <div className="flex h-screen w-screen bg-vscode-bg text-vscode-text overflow-hidden">
      {/* --- Left Sidebar (Explorer) --- */}
      <div className="w-64 flex-shrink-0 bg-vscode-sidebar border-r border-vscode-border flex flex-col">
        <div className="p-3 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider opacity-60">Notes</h2>
          <div className="flex space-x-1">
            <button onClick={() => handleCreate('file')} className="p-1 hover:bg-vscode-active rounded" title="New Note">
              <Plus size={16} />
            </button>
            <button onClick={() => handleCreate('directory')} className="p-1 hover:bg-vscode-active rounded" title="New Folder">
              <Folder size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {files.map(node => (
            <FileTreeItem 
              key={node.path} 
              node={node} 
              level={0} 
              onSelect={setSelectedFile} 
              selectedPath={selectedFile?.path || null}
              onAction={(action, node) => action === 'delete' && handleDelete(node)}
            />
          ))}
        </div>
      </div>

      {/* --- Center Pane (Editor) --- */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedFile ? (
          <>
            <div className="h-10 border-b border-vscode-border flex items-center px-4 justify-between bg-vscode-sidebar">
              <div className="flex items-center space-x-2 truncate">
                <FileText size={14} />
                <span className="text-sm font-medium truncate">{selectedFile.name}</span>
                {isDirty && <div className="w-2 h-2 rounded-full bg-vscode-text opacity-50" />}
              </div>
              <div className="flex items-center space-x-3">
                {diffMode.active ? (
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-vscode-accent font-medium">Comparing: {formatDistanceToNow(diffMode.commit!.timestamp * 1000)} ago</span>
                    <button onClick={restoreVersion} className="text-xs bg-vscode-accent text-white px-2 py-1 rounded hover:bg-opacity-90">Restore</button>
                    <button onClick={() => setDiffMode({ active: false })} className="p-1 hover:bg-vscode-active rounded"><X size={16} /></button>
                  </div>
                ) : (
                  <>
                    <button onClick={() => setShowPreview(!showPreview)} className={`p-1 rounded ${showPreview ? 'bg-vscode-active' : 'hover:bg-vscode-active'}`}>
                      <Split size={16} />
                    </button>
                    <button onClick={handleSave} className="p-1 hover:bg-vscode-active rounded" title="Save (Ctrl+S)">
                      <Save size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="flex-1 relative flex overflow-hidden">
              <div className={`flex-1 h-full ${diffMode.active ? 'hidden' : 'block'}`}>
                <CodeMirror
                  value={content}
                  height="100%"
                  theme={oneDark}
                  extensions={[markdown({ base: markdownLanguage })]}
                  onChange={(value) => {
                    setContent(value);
                    setIsDirty(value !== originalContent);
                  }}
                  className="text-base"
                />
              </div>
              {diffMode.active && (
                <div className="flex-1 h-full overflow-y-auto bg-vscode-bg p-4 font-mono text-sm">
                  <div className="mb-4 flex items-center space-x-4 text-xs opacity-60">
                    <div className="flex items-center"><div className="w-3 h-3 bg-green-900/30 border border-green-500 mr-1" /> Added</div>
                    <div className="flex items-center"><div className="w-3 h-3 bg-red-900/30 border border-red-500 mr-1" /> Removed</div>
                  </div>
                  {diffLines(diffMode.oldContent || '', content).map((part, i) => (
                    <div 
                      key={i} 
                      className={`${part.added ? 'bg-green-900/20 text-green-400' : part.removed ? 'bg-red-900/20 text-red-400 line-through opacity-50' : ''} whitespace-pre-wrap`}
                    >
                      {part.value}
                    </div>
                  ))}
                </div>
              )}
              {showPreview && !diffMode.active && (
                <div className="w-1/2 border-l border-vscode-border bg-vscode-bg p-8 overflow-y-auto prose prose-invert max-w-none">
                  {/* Simple markdown preview placeholder - in a real app use react-markdown */}
                  <div className="opacity-50 italic text-sm mb-4">Preview Mode</div>
                  <pre className="whitespace-pre-wrap font-sans">{content}</pre>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center opacity-20">
            <h1 className="text-6xl font-bold mb-4">BrainGit</h1>
            <p className="text-xl">Select a note to start editing</p>
            <div className="mt-8 grid grid-cols-2 gap-4 text-sm">
              <div>Ctrl+S</div><div>Save</div>
              <div>Ctrl+Shift+S</div><div>Snapshot</div>
              <div>Ctrl+N</div><div>New Note</div>
            </div>
          </div>
        )}
      </div>

      {/* --- Right Sidebar (History) --- */}
      <div className="w-64 flex-shrink-0 bg-vscode-sidebar border-l border-vscode-border flex flex-col">
        <div className="p-3 border-b border-vscode-border">
          <h2 className="text-xs font-bold uppercase tracking-wider opacity-60 mb-3">History</h2>
          <button 
            onClick={handleNewSnapshot}
            className="w-full py-2 bg-vscode-accent text-white rounded text-sm font-medium hover:bg-opacity-90 transition-colors flex items-center justify-center space-x-2"
          >
            <Clock size={14} />
            <span>New Snapshot</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {history.length > 0 ? (
            history.map(commit => (
              <div 
                key={commit.oid} 
                onClick={() => viewHistoryVersion(commit)}
                className={`p-3 border-b border-vscode-border cursor-pointer hover:bg-vscode-active transition-colors ${diffMode.commit?.oid === commit.oid ? 'bg-vscode-active' : ''}`}
              >
                <div className="text-sm font-medium text-vscode-text-bright truncate">{commit.message}</div>
                <div className="text-xs opacity-50 mt-1 flex justify-between">
                  <span>{formatDistanceToNow(commit.timestamp * 1000)} ago</span>
                  <span className="font-mono">{commit.oid.substring(0, 7)}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="p-8 text-center opacity-30 text-sm italic">No history yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
