import { useState } from 'react';

export default function LoginView({ setToken, setUser, onLoginSuccess, apiCall, projectName }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isInitMode, setIsInitMode] = useState(false);
  const [initSecret, setInitSecret] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      // Pass project_name to the backend to resolve the correct user context for authentication
      const data = await apiCall('/auth', 'POST', { 
        project_name: projectName, 
        username, 
        password 
      });
      
      localStorage.setItem('auth_token', data.token);
      
      // Store the project_name in state to maintain the user's current context
      localStorage.setItem('auth_user', JSON.stringify({ 
        username: data.username, 
        adminlevel: data.adminlevel,
        project_name: data.project_name
      }));
      
      setToken(data.token);
      setUser({ 
        username: data.username, 
        adminlevel: data.adminlevel,
        project_name: data.project_name
      });

      if (typeof onLoginSuccess === 'function') {
        onLoginSuccess();
      }
    } catch (err) { 
      console.warn("Error during login:", err)
    }
  };

  const handleInit = async (e) => {
    e.preventDefault();
    try {
      await apiCall('/init', 'POST', {
        project_name: projectName,
        admin_username: username,
        admin_password: password,
        init_secret: initSecret
      });
      alert('Database initialized! You can now log in.');
      setIsInitMode(false);
      setInitSecret('');
    } catch (err) {
      console.warn("Error during initialization:", err);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-20 bg-white p-8 rounded-xl shadow-sm border border-slate-200">
      <h2 className="text-2xl font-bold text-center mb-6">
        {isInitMode ? `Initialize ${projectName}` : `Sign in to ${projectName}`}
      </h2>
      <form onSubmit={isInitMode ? handleInit : handleLogin} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Username</label>
          <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="w-full border rounded-md p-2" required />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full border rounded-md p-2" required />
        </div>
        {isInitMode && (
          <div>
            <label className="block text-sm font-medium mb-1 text-amber-700">Master Secret</label>
            <input 
              type="password" 
              value={initSecret} 
              onChange={e => setInitSecret(e.target.value)} 
              className="w-full border border-amber-300 rounded-md p-2 focus:ring-amber-500 focus:border-amber-500" 
              placeholder="Server initialization password"
              required 
            />
          </div>
        )}
        <button type="submit" className="w-full bg-indigo-600 text-white py-2 rounded-md hover:bg-indigo-700 font-medium transition-colors">
          {isInitMode ? 'Bootstrap DB' : 'Login'}
        </button>
      </form>
      <div className="mt-4 text-center">
        <button onClick={() => setIsInitMode(!isInitMode)} className="text-sm text-indigo-500 hover:underline">
          {isInitMode ? 'Back to Login' : 'Need to initialize first run?'}
        </button>
      </div>
    </div>
  );
}