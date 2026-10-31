import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="live-root"><div className="live-bg" />
      <div className="live-loading">
        <img className="live-logo" src="/logo-sm.png" alt="" />
        <h1 className="live-title" style={{ fontSize: 40 }}>الصفحة غير موجودة</h1>
        <Link className="btn gold" href="/">العودة للصفحة الرئيسية</Link>
      </div>
    </div>
  );
}
