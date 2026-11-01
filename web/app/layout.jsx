import './fonts';
import '../styles/base.css';
import '../styles/board.css';
import '../styles/overlay.css';
import '../styles/live.css';
import '../styles/skins.css';
import '../styles/admin.css';
import '../styles/teaser.css';
import '../styles/games.css';

export const metadata = {
  title: 'تحدي المليون · Koydam',
  description: 'تحدي المليون: منافسة الهدايا المباشرة على تيك توك',
  icons: { icon: '/favicon.png', apple: '/apple-touch-icon.png' },
};
export const viewport = { themeColor: '#0b0a0f', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
