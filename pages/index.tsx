import Head from 'next/head';
import { useRouter } from 'next/router';
import type { FormEvent } from 'react';
import { useState } from 'react';
import type { GetServerSideProps } from 'next';
import { isAuthorized, isPasswordConfigured } from '../src/lib/auth';

type Props = {
  passwordConfigured: boolean;
};

export const getServerSideProps: GetServerSideProps<Props> = async ({ req }) => {
  if (isAuthorized(req?.headers?.cookie)) {
    return {
      redirect: {
        destination: '/app',
        permanent: false,
      },
    };
  }

  return {
    props: {
      passwordConfigured: isPasswordConfigured(),
    },
  };
};

export default function LoginPage({ passwordConfigured }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordConfigured) return;

    setStatus('loading');
    setError(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Login failed' }));
        setError(data?.error || 'Invalid password');
        setStatus('idle');
        return;
      }

      await router.replace('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setStatus('idle');
    }
  }

  return (
    <>
      <Head>
        <title>Yahoo Fantasy Agent | Login</title>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main className="login-shell">
        <form onSubmit={handleSubmit} className="login-card">
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>Yahoo Fantasy Agent</h1>
          <p style={{ marginBottom: '1.5rem', color: 'rgba(226,232,240,0.75)' }}>Sign in to access the dashboard.</p>

          {!passwordConfigured ? (
            <p style={{ color: '#f8fafc', fontSize: '0.95rem', lineHeight: 1.5 }}>
              Dashboard password is not configured. Set <code>DASHBOARD_PASSWORD</code> in your environment
              variables to enable access.
            </p>
          ) : (
            <>
              <label htmlFor="password" className="login-label">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="Enter password"
                className="login-input"
                disabled={status === 'loading'}
                autoComplete="current-password"
              />

              {error && (
                <p className="login-error">{error}</p>
              )}

              <button
                type="submit"
                className="login-button"
                disabled={status === 'loading'}
              >
                {status === 'loading' ? 'Signing in…' : 'Sign in'}
              </button>
            </>
          )}
        </form>
        <style jsx>{`
          .login-shell {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(140deg, #0f172a 0%, #122042 55%, #1d2a52 100%);
            padding: 1.75rem;
            color: #f8fafc;
          }

          .login-card {
            width: 100%;
            max-width: 380px;
            background: rgba(17, 24, 39, 0.92);
            border-radius: 16px;
            padding: 2.5rem 2.25rem;
            box-shadow: 0 24px 48px rgba(15, 23, 42, 0.55);
            border: 1px solid rgba(148, 163, 184, 0.18);
          }

          .login-label {
            display: block;
            font-size: 0.95rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
            color: rgba(226, 232, 240, 0.85);
          }

          .login-input {
            width: 100%;
            padding: 0.85rem 1rem;
            border-radius: 10px;
            border: 1px solid rgba(148, 163, 184, 0.35);
            background: rgba(2, 6, 23, 0.75);
            color: #f8fafc;
            font-size: 1rem;
            line-height: 1.45;
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
            box-sizing: border-box;
            margin-bottom: 1.1rem;
          }

          .login-input:focus {
            outline: none;
            border-color: rgba(59, 130, 246, 0.75);
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25);
          }

          .login-error {
            color: #f87171;
            margin-bottom: 1rem;
            font-size: 0.9rem;
          }

          .login-button {
            width: 100%;
            padding: 0.85rem 1rem;
            border-radius: 10px;
            border: none;
            background: #38bdf8;
            color: #0f172a;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s ease-in-out, transform 0.2s ease-in-out;
          }

          .login-button:hover:not(:disabled) {
            background: #0ea5e9;
            transform: translateY(-1px);
          }

          .login-button:disabled {
            cursor: default;
            opacity: 0.7;
          }
        `}</style>
      </main>
    </>
  );
}
