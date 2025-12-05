import { useState, useEffect } from 'react';
import './InstallPrompt.css';

function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  // Check if should show prompt on mount
  const shouldShowPrompt = () => {
    // Don't show if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      return false;
    }

    // Don't show if dismissed recently (within 7 days)
    const dismissed = localStorage.getItem('installPromptDismissed');
    if (dismissed) {
      const dismissedTime = parseInt(dismissed, 10);
      const daysSinceDismissed = (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);
      if (daysSinceDismissed < 7) {
        return false;
      }
    }

    return true;
  };

  const [showPrompt, setShowPrompt] = useState(shouldShowPrompt);

  useEffect(() => {
    const handler = (e) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later
      setDeferredPrompt(e);
      // Show the install prompt if conditions are met
      if (shouldShowPrompt()) {
        setShowPrompt(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      return;
    }

    // Show the install prompt
    deferredPrompt.prompt();

    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;

    console.log(`User response to the install prompt: ${outcome}`);

    // Clear the deferredPrompt so it can only be used once
    setDeferredPrompt(null);
    setShowPrompt(false);
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    // Store dismissal in localStorage to not show again for a while
    localStorage.setItem('installPromptDismissed', Date.now().toString());
  };

  if (!showPrompt || !deferredPrompt) {
    return null;
  }

  return (
    <div className="install-prompt">
      <div className="install-prompt-content">
        <div className="install-prompt-icon">
          📱
        </div>
        <div className="install-prompt-text">
          <h3>Instalar Transcript X</h3>
          <p>Accede más rápido desde tu pantalla de inicio</p>
        </div>
        <div className="install-prompt-actions">
          <button
            className="install-prompt-btn install"
            onClick={handleInstallClick}
          >
            Instalar
          </button>
          <button
            className="install-prompt-btn dismiss"
            onClick={handleDismiss}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

export default InstallPrompt;
