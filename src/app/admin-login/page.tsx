'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Admin Login Page
 * ================
 * Provides a simple login form for accessing the admin panel
 * while the full Supabase Auth integration is being configured.
 *
 * Hardcoded credentials (temporary):
 *   Username: admin
 *   Password: cognova2026
 */

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'cognova2026';

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      // Create a fake JWT payload with superadmin role
      const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
      const payload = btoa(
        JSON.stringify({
          sub: 'admin-001',
          email: 'admin@brain.mr-imperfect.online',
          user_role: 'superadmin',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 86400,
        })
      );
      const fakeJwt = `${header}.${payload}.`;

      // Set the session cookie
      document.cookie = `sb-session=${fakeJwt}; path=/; max-age=86400; SameSite=Lax`;

      // Redirect to admin dashboard
      router.push('/admin');
    } else {
      setError('Invalid username or password');
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Cognova Admin</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">Sign in to access the admin panel</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="Enter username"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="Enter password"
                required
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-medium rounded-lg transition-colors"
            >
              Sign In
            </button>
          </form>

          <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-xs text-amber-700 dark:text-amber-400">
            <p className="font-medium mb-1">Default Credentials:</p>
            <p>Username: <strong>admin</strong></p>
            <p>Password: <strong>cognova2026</strong></p>
          </div>
        </div>
      </div>
    </main>
  );
}
