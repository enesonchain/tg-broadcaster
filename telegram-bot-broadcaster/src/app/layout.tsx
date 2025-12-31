import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Telegram Bot Broadcaster',
  description: 'Broadcast messages to Telegram groups and channels using your bot - Fast, Safe, Free',
  keywords: ['telegram', 'bot', 'broadcast', 'messaging', 'channels', 'groups'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
