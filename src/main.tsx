import ReactDOM from 'react-dom/client';
import App from './App';
import { PreviewWindow } from './preview/PreviewWindow';
import { parsePreviewParam } from './lib/preview';
import '@xterm/xterm/css/xterm.css';
import './styles/app.css';

// preview-* ウィンドウは同じ index.html を ?preview=<rel> 付きで開く。
// パラメータがあればプレビュー、無ければメインアプリを描画する。
const previewRel = parsePreviewParam(window.location.search);
const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(previewRel ? <PreviewWindow rel={previewRel} /> : <App />);
