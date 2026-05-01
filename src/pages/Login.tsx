import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../hooks/useStore';
import { LogIn, User as UserIcon, Shield, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'student' | 'admin'>('student');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    
    try {
      const loggedUser = await login(email, password);
      if (loggedUser) {
        if (loggedUser.role === role) {
          navigate(role === 'admin' ? '/admin' : '/student');
        } else {
          setError(`Compte trouvé, mais ce n'est pas un compte ${role === 'admin' ? 'Administrateur' : 'Étudiant'}.`);
        }
      } else {
        setError('Email ou mot de passe incorrect. Vérifiez vos identifiants.');
      }
    } catch {
      setError('Erreur de connexion au serveur. Vérifiez que le backend est lancé.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center py-12">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white border border-slate-200 rounded-[2.5rem] p-10 shadow-sm space-y-8"
      >
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Espace Sécurisé</h1>
          <p className="text-slate-500 text-sm font-medium">Connectez-vous à votre portail académique</p>
        </div>

        <div className="flex bg-slate-50 p-1 rounded-2xl border border-slate-100">
          <button
            onClick={() => { setRole('student'); setError(null); }}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${role === 'student' ? 'bg-white shadow-sm border border-slate-100' : 'text-slate-400'}`}
          >
            <UserIcon className="w-4 h-4" />
            Étudiant
          </button>
          <button
            onClick={() => { setRole('admin'); setError(null); }}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${role === 'admin' ? 'bg-white shadow-sm border border-slate-100' : 'text-slate-400'}`}
          >
            <Shield className="w-4 h-4" />
            Admin
          </button>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-rose-50 border border-rose-100 text-rose-600 p-4 rounded-2xl flex items-center gap-3 text-sm font-medium"
            >
              <AlertCircle className="w-5 h-5 shrink-0" />
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-400 px-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={role === 'admin' ? 'admin@certiverify.com' : 'jean@student.com'}
                className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-300"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-400 px-1">Mot de passe</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-300"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-2 shadow-lg shadow-slate-200 mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
                <LogIn className="w-5 h-5 opacity-40" />
              </motion.div>
            ) : (
              <LogIn className="w-5 h-5" />
            )}
            {isLoading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>

        <div className="text-center text-xs text-slate-400 border-t border-slate-50 pt-6">
          <p className="mb-2">Identification de test ({role === 'admin' ? 'Admin' : 'Étudiant'}) :</p>
          <div className="font-mono bg-slate-50 p-3 rounded-xl border border-slate-100 inline-block text-left">
            <p><span className="text-slate-300">Email:</span> {role === 'admin' ? 'admin@certiverify.com' : 'jean@student.com'}</p>
            <p><span className="text-slate-300">Pass:</span> {role === 'admin' ? 'admin123' : 'student123'}</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
