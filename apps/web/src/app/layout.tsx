import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { ClerkProvider } from '@clerk/nextjs';
import Providers from './providers';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'QuantX — Indian Stock Market Research & Paper Trading Platform',
    template: '%s | QuantX',
  },
  description: 'Real-time Indian stock market dashboard with quantitative analysis, AI-driven research picks, live NSE/BSE data, and paper trading.',
  keywords: ['Indian stocks', 'NSE', 'BSE', 'stock market', 'paper trading', 'quantitative analysis', 'QuantX'],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`} style={{ colorScheme: 'dark' }}>
        <body className={`${inter.className} font-sans bg-background text-foreground antialiased overflow-hidden relative selection:bg-primary/25 selection:text-primary-foreground`}>
          {/* Ambient Institutional Radial Mesh Gradient */}
          <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
            <div className="absolute -top-[20%] left-1/2 -translate-x-1/2 h-[650px] w-[1000px] bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.14),rgba(255,255,255,0))] blur-3xl opacity-80" />
            <div className="absolute top-[35%] -left-[15%] h-[500px] w-[600px] bg-[radial-gradient(ellipse_at_center,rgba(56,189,248,0.05),rgba(0,0,0,0))] blur-3xl" />
            <div className="absolute bottom-[5%] -right-[15%] h-[500px] w-[600px] bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.06),rgba(0,0,0,0))] blur-3xl" />
          </div>

          <Providers>
            <div className="relative z-10 flex h-screen w-full bg-background/80 backdrop-blur-[1px]">
              <Sidebar />
              <div className="flex flex-1 flex-col overflow-hidden">
                <Header />
                <main className="flex-1 overflow-y-auto bg-transparent p-4 sm:p-5 lg:p-6 xl:p-8">
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

