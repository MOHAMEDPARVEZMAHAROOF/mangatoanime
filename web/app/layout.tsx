import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MangaToAnime',
  description: 'Convert manga PDF panels into anime-styled fight scene videos',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
