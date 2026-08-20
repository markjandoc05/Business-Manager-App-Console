import type {Metadata} from 'next';
import './globals.css'; // Global styles
import { AuthProvider } from '@/lib/auth-context';
import { ConsoleProvider } from '@/lib/console-context';

export const metadata: Metadata = {
  title: 'BSM Developer Console',
  description: 'Private developer administration platform for managing customer installations of Business Sales Manager (BSM).',
  openGraph: {
    title: 'BSM Developer Console',
    description: 'Private developer administration platform for managing customer installations of Business Sales Manager (BSM).',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BSM Developer Console',
    description: 'Private developer administration platform for managing customer installations of Business Sales Manager (BSM).',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className="bg-gray-50 text-gray-900 font-sans antialiased selection:bg-blue-600 selection:text-white">
        <AuthProvider>
          <ConsoleProvider>{children}</ConsoleProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
