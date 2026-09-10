import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;
type PathNode = Record<string, string | number | undefined> & {
  tag?: 'path' | 'circle' | 'rect';
};

function makeIcon(paths: PathNode[]) {
  function Icon(props: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {paths.map(({ tag = 'path', ...path }, index) => {
          if (tag === 'circle') return <circle key={index} {...path} />;
          if (tag === 'rect') return <rect key={index} {...path} />;
          return <path key={index} {...path} />;
        })}
      </svg>
    );
  }
  return Icon;
}

export const AlertCircle = makeIcon([
  { tag: 'circle', cx: 12, cy: 12, r: 10 },
  { d: 'M12 8v4' },
  { d: 'M12 16h.01' },
]);
export const AlertTriangle = makeIcon([
  { d: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z' },
  { d: 'M12 9v4' },
  { d: 'M12 17h.01' },
]);
export const ArrowLeft = makeIcon([{ d: 'M19 12H5' }, { d: 'm12 19-7-7 7-7' }]);
export const ArrowRight = makeIcon([{ d: 'M5 12h14' }, { d: 'm12 5 7 7-7 7' }]);
// "Điền xuống" (fill-down Giá vốn/Markup) - dung dung path chuan cua lucide
// "arrow-down-to-line" (khong cai them thu vien, tu ve lai bang makeIcon co
// san, giu 24x24 viewBox nhu cac icon khac trong file nay).
export const ArrowDownToLine = makeIcon([{ d: 'M12 17V3' }, { d: 'm6 11 6 6 6-6' }, { d: 'M19 21H5' }]);
export const Building2 = makeIcon([
  { d: 'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18' },
  { d: 'M6 12H4a2 2 0 0 0-2 2v8h20v-8a2 2 0 0 0-2-2h-2' },
  { d: 'M10 6h4' },
  { d: 'M10 10h4' },
  { d: 'M10 14h4' },
]);
export const CalendarDays = makeIcon([
  { tag: 'rect', x: 3, y: 4, width: 18, height: 18, rx: 2 },
  { d: 'M16 2v4' },
  { d: 'M8 2v4' },
  { d: 'M3 10h18' },
]);
export const CheckCircle2 = makeIcon([
  { tag: 'circle', cx: 12, cy: 12, r: 10 },
  { d: 'm9 12 2 2 4-4' },
]);
export const ChevronDown = makeIcon([{ d: 'm6 9 6 6 6-6' }]);
export const ChevronUp = makeIcon([{ d: 'm18 15-6-6-6 6' }]);
export const Eye = makeIcon([
  { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z' },
  { tag: 'circle', cx: 12, cy: 12, r: 3 },
]);
export const Clock = makeIcon([
  { tag: 'circle', cx: 12, cy: 12, r: 10 },
  { d: 'M12 6v6l4 2' },
]);
export const FileText = makeIcon([
  { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' },
  { d: 'M14 2v6h6' },
  { d: 'M16 13H8' },
  { d: 'M16 17H8' },
  { d: 'M10 9H8' },
]);
export const LayoutGrid = makeIcon([
  { tag: 'rect', x: 3, y: 3, width: 7, height: 7, rx: 1 },
  { tag: 'rect', x: 14, y: 3, width: 7, height: 7, rx: 1 },
  { tag: 'rect', x: 14, y: 14, width: 7, height: 7, rx: 1 },
  { tag: 'rect', x: 3, y: 14, width: 7, height: 7, rx: 1 },
]);
export const Loader2 = makeIcon([{ d: 'M21 12a9 9 0 1 1-6.2-8.6' }]);
export const Mail = makeIcon([
  { tag: 'rect', x: 3, y: 5, width: 18, height: 14, rx: 2 },
  { d: 'm3 7 9 6 9-6' },
]);
export const MapPin = makeIcon([
  { d: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z' },
  { tag: 'circle', cx: 12, cy: 10, r: 3 },
]);
export const MessageCircle = makeIcon([
  { d: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-4-.9L3 21l1.8-4.6A8.5 8.5 0 1 1 21 11.5Z' },
]);
export const MessageSquare = makeIcon([
  { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
]);
export const MoreVertical = makeIcon([
  { tag: 'circle', cx: 12, cy: 5, r: 1 },
  { tag: 'circle', cx: 12, cy: 12, r: 1 },
  { tag: 'circle', cx: 12, cy: 19, r: 1 },
]);
export const PauseCircle = makeIcon([
  { tag: 'circle', cx: 12, cy: 12, r: 10 },
  { d: 'M10 15V9' },
  { d: 'M14 15V9' },
]);
export const Send = makeIcon([
  { d: 'm22 2-7 20-4-9-9-4Z' },
  { d: 'M22 2 11 13' },
]);
export const Settings = makeIcon([
  { tag: 'circle', cx: 12, cy: 12, r: 3 },
  { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z' },
]);
export const Phone = makeIcon([
  { d: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.4 2.1L8 9.7a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2Z' },
]);
export const Plus = makeIcon([{ d: 'M12 5v14' }, { d: 'M5 12h14' }]);
export const Pencil = makeIcon([
  { d: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' },
  { d: 'm15 5 4 4' },
]);
export const Link2 = makeIcon([
  { d: 'M9 17H7A5 5 0 0 1 7 7h2' },
  { d: 'M15 7h2a5 5 0 1 1 0 10h-2' },
  { d: 'M8 12h8' },
]);
export const History = makeIcon([
  { d: 'M3 12a9 9 0 1 0 2.6-6.3L3 8' },
  { d: 'M3 3v5h5' },
  { d: 'M12 7v5l4 2' },
]);
export const ExternalLink = makeIcon([
  { d: 'M15 3h6v6' },
  { d: 'M10 14 21 3' },
  { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' },
]);
export const GitBranchPlus = makeIcon([
  { tag: 'circle', cx: 6, cy: 18, r: 3 },
  { d: 'M6 15v-3a3 3 0 0 1 3-3h3' },
  { d: 'M15 6h6' },
  { d: 'M18 3v6' },
  { d: 'M6 9V3' },
]);
export const RotateCcw = makeIcon([
  { d: 'M3 12a9 9 0 1 0 3-6.7L3 8' },
  { d: 'M3 3v5h5' },
]);
export const TableIcon = makeIcon([
  { tag: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
  { d: 'M3 9h18' },
  { d: 'M3 15h18' },
  { d: 'M9 3v18' },
]);
export const Tag = makeIcon([
  { d: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z' },
  { tag: 'circle', cx: 7.5, cy: 7.5, r: 0.5 },
]);
export const Trash2 = makeIcon([
  { d: 'M3 6h18' },
  { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' },
  { d: 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6' },
]);
export const Trophy = makeIcon([
  { d: 'M8 21h8' },
  { d: 'M12 17v4' },
  { d: 'M7 4h10v6a5 5 0 0 1-10 0Z' },
  { d: 'M5 5H3a2 2 0 0 0 2 4' },
  { d: 'M19 5h2a2 2 0 0 1-2 4' },
]);
export const Sparkles = makeIcon([
  { d: 'M12 3v4' },
  { d: 'M12 17v4' },
  { d: 'M3 12h4' },
  { d: 'M17 12h4' },
  { d: 'm5.6 5.6 2.8 2.8' },
  { d: 'm15.6 15.6 2.8 2.8' },
  { d: 'm18.4 5.6-2.8 2.8' },
  { d: 'm8.4 15.6-2.8 2.8' },
]);
export const User = makeIcon([
  { tag: 'circle', cx: 12, cy: 7, r: 4 },
  { d: 'M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2' },
]);
export const UserCog = makeIcon([
  { tag: 'circle', cx: 9, cy: 7, r: 4 },
  { d: 'M3 21v-2a4 4 0 0 1 4-4h3' },
  { tag: 'circle', cx: 17, cy: 17, r: 3 },
  { d: 'M17 13v1' },
  { d: 'M17 20v1' },
  { d: 'M13 17h1' },
  { d: 'M20 17h1' },
]);
export const Wallet = makeIcon([
  { d: 'M20 7H5a2 2 0 0 0 0 4h15v8a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h13a2 2 0 0 1 2 2Z' },
  { d: 'M16 14h.01' },
]);
export const X = makeIcon([{ d: 'M18 6 6 18' }, { d: 'm6 6 12 12' }]);
export const XCircle = makeIcon([
  { tag: 'circle', cx: 12, cy: 12, r: 10 },
  { d: 'm15 9-6 6' },
  { d: 'm9 9 6 6' },
]);
