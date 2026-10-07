import type {Metadata} from 'next';
import './globals.css'; // Global styles
import { AuthProvider } from '@/lib/auth-context';

export const metadata: Metadata = {
  title: 'Ventale Developer Console',
  description: 'Private platform administration console for centralized Ventale organizations, memberships, subscriptions, and audit operations.',
  openGraph: {
    title: 'Ventale Developer Console',
    description: 'Private platform administration console for centralized Ventale organizations, memberships, subscriptions, and audit operations.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Ventale Developer Console',
    description: 'Private platform administration console for centralized Ventale organizations, memberships, subscriptions, and audit operations.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className="bg-gray-50 text-gray-900 font-sans antialiased selection:bg-blue-600 selection:text-white">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
