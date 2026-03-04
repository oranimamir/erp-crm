import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

interface User {
  id: number;
  username: string;
  display_name: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<{ step: 'done' } | { step: 'otp'; userId: number }>;
  verifyOtp: (userId: number, code: string) => Promise<void>;
  resendOtp: (userId: number) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (token) {
      api.get('/auth/me')
        .then(res => setUser(res.data))
        .catch(() => {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setToken(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = async (username: string, password: string): Promise<{ step: 'done' } | { step: 'otp'; userId: number }> => {
    const res = await api.post('/auth/login', { username, password });
    if (res.data.step === 'otp') {
      return { step: 'otp', userId: res.data.user_id };
    }
    localStorage.setItem('token', res.data.token);
    localStorage.setItem('user', JSON.stringify(res.data.user));
    setToken(res.data.token);
    setUser(res.data.user);
    return { step: 'done' };
  };

  const verifyOtp = async (userId: number, code: string): Promise<void> => {
    const res = await api.post('/auth/verify-otp', { user_id: userId, code });
    localStorage.setItem('token', res.data.token);
    localStorage.setItem('user', JSON.stringify(res.data.user));
    setToken(res.data.token);
    setUser(res.data.user);
  };

  const resendOtp = async (userId: number): Promise<void> => {
    await api.post('/auth/resend-otp', { user_id: userId });
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    navigate('/login');
  };

  return (
    <AuthContext.Provider value={{ user, token, login, verifyOtp, resendOtp, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
