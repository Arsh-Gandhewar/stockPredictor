import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ClerkProvider } from '@clerk/nextjs';
import Providers from './providers';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'QuantX | Premium Market Analytics',
  description: 'AI-powered investment insights and paper trading for Indian stocks.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className="dark" style={{ colorScheme: 'dark' }}>
        <body className={`${inter.className} bg-background text-foreground antialiased overflow-hidden`}>
          <Providers>
            <div className="flex h-screen w-full bg-background">
              <Sidebar />
              <div className="flex flex-1 flex-col overflow-hidden">
                <Header />
                <main className="flex-1 overflow-y-auto bg-background/50 p-6">
                  {children}
                </main>
              </div>
            </div>
          </Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
