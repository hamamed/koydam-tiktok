'use client';
/**
 * Lucide icons for the dashboard. `iconize(node)` turns emojis inside text (labels, titles,
 * section content) into the matching Lucide icon, so the UI never shows emoji glyphs.
 */
import { Children, cloneElement, Fragment, isValidElement } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, BarChart3, Bot, Building2, CaseSensitive, Check, CircleCheck, Clapperboard, Crown, Dices,
  Eye, ExternalLink, FileText, Flag, Flame, Folder, Gem, Gift, Globe, Hammer, Hand, HandHeart, Heart, Image as ImageIcon,
  KeyRound, LayoutDashboard, LayoutGrid, List, Lock, LogOut, Medal, MessageCircle, Mic, Monitor, Moon, Palette, PanelRight,
  Pencil, Play, Plug, Plus, Puzzle, RefreshCw, Repeat2, Rocket, Save, ScrollText, Server, Smartphone, Smile, Sparkles, Square,
  Sun, Tag, TrainFront, Trash2, TrendingUp, Trophy, Type, User, Users, Volume2, Wrench, X, Zap, ChevronUp, ChevronDown, Copy, Menu,
  Flower2, Lightbulb, Rows3,
} from 'lucide-react';

/** Names used by <Icon name="…"> across the dashboard. */
export const NAMED = {
  sun: Sun, moon: Moon, overview: LayoutDashboard, plug: Plug, flag: Flag, gift: Gift, palette: Palette, tools: Wrench,
  server: Server, file: FileText, logs: ScrollText, update: RefreshCw, logout: LogOut, external: ExternalLink, copy: Copy,
  play: Play, stop: Square, dice: Dices, trash: Trash2, save: Save, plus: Plus, up: ChevronUp, down: ChevronDown, check: Check,
  close: X, eye: Eye, build: Hammer, users: Users, trophy: Trophy, bolt: Zap, key: KeyRound, menu: Menu, video: Clapperboard,
  heart: Heart, crown: Crown, globe: Globe, image: ImageIcon, type: Type, tag: Tag, train: TrainFront, puzzle: Puzzle,
  phone: Smartphone, monitor: Monitor, chart: BarChart3, mic: Mic, volume: Volume2, rocket: Rocket, lock: Lock, user: User,
};

const EMOJI = {
  '🎨': Palette, '🏷': Tag, '🌍': Globe, '🌐': Globe, '🎁': Gift, '🏆': Trophy, '💛': Heart, '❤': Heart, '🚆': TrainFront,
  '🧩': Puzzle, '🔤': Type, '🔠': CaseSensitive, '🌄': ImageIcon, '🖼': ImageIcon, '📁': Folder, '🎬': Clapperboard,
  '📱': Smartphone, '🖥': Monitor, '☀': Sun, '🌙': Moon, '⬆': ArrowUp, '⬇': ArrowDown, '▦': LayoutGrid, '▮': PanelRight,
  '☰': List, '🙂': Smile, '💎': Gem, '👑': Crown, '🔁': Repeat2, '🥇': Medal, '🥈': Medal, '🥉': Medal, '👁': Eye, '🏳': Flag,
  '🌹': Flower2, '🔄': RefreshCw, '✅': CircleCheck, '🔑': KeyRound, '➕': Plus, '👋': Hand, '🙏': HandHeart, '🔥': Flame,
  '💬': MessageCircle, '✏': Pencil, '🚀': Rocket, '🔒': Lock, '⚠': AlertTriangle, '👥': Users, '👤': User, '📜': ScrollText,
  '🔊': Volume2, '🎤': Mic, '📈': TrendingUp, '📊': BarChart3, '⚡': Zap, '✨': Sparkles, '🤖': Bot, '🏢': Building2, '💡': Lightbulb,
  '🗂': Rows3, '🎵': Sparkles,
};
const RE = /([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{25A0}-\u{25FF}])️?\s?/gu;
const KEEP = new Set(['▲', '▼', '●', '✓', '✗', '←', '→']); // plain typography, not emoji pictures

/** "🎨 الأشكال" -> [<Palette/>, "الأشكال"]. Unknown emojis are dropped. */
export function iconText(str, keyBase = 'i') {
  if (typeof str !== 'string' || !RE.test(str)) { RE.lastIndex = 0; return str; }
  RE.lastIndex = 0;
  const out = []; let last = 0; let m; let n = 0;
  while ((m = RE.exec(str))) {
    const ch = m[1];
    if (KEEP.has(ch)) continue;
    if (m.index > last) out.push(str.slice(last, m.index));
    const C = EMOJI[ch];
    if (C) out.push(<C key={`${keyBase}${n++}`} className="lc-ico" aria-hidden="true" />);
    last = m.index + m[0].length;
  }
  if (last < str.length) out.push(str.slice(last));
  return out.length === 1 ? out[0] : out;
}
/** Removes emojis from plain text (for <option>, title attributes…). */
export const stripEmoji = (str) => (typeof str === 'string' ? str.replace(RE, (m0, ch) => (KEEP.has(ch) ? m0 : '')).trim() : str);

const SKIP = new Set(['input', 'textarea', 'select', 'code', 'pre', 'script', 'style']);
/** Deep: converts emojis in strings inside elements created in the same render. */
export function iconize(node, depth = 0) {
  if (node == null || typeof node === 'boolean') return node;
  if (typeof node === 'string') return iconText(node, `e${depth}_`);
  if (Array.isArray(node)) return node.map((c, i) => (typeof c === 'string' ? <Fragment key={`s${i}`}>{iconText(c, `a${depth}_${i}_`)}</Fragment> : iconize(c, depth + 1)));
  if (!isValidElement(node) || depth > 25) return node;
  if (typeof node.type === 'string' && SKIP.has(node.type)) return node;
  if (node.type === 'option') return cloneElement(node, {}, stripEmoji(String(Children.toArray(node.props.children).join(''))));
  const p = node.props || {};
  const patch = {};
  if (p.children !== undefined) patch.children = iconize(p.children, depth + 1);
  for (const k of ['title', 'desc', 'label', 'hint', 'actions']) {
    if (k in p && (typeof p[k] === 'string' || isValidElement(p[k]) || Array.isArray(p[k]))) {
      patch[k] = k === 'title' && typeof node.type === 'string' ? stripEmoji(p[k]) : iconize(p[k], depth + 1);
    }
  }
  if ('placeholder' in p && typeof p.placeholder === 'string') patch.placeholder = stripEmoji(p.placeholder);
  return Object.keys(patch).length ? cloneElement(node, patch) : node;
}
