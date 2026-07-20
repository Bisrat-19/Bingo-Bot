import { authDebug, close as tgClose } from '@/lib/telegram';

interface Props {
  name: string;
}

/**
 * Shown when the player opens the Mini App without being registered. Registration is
 * done in the bot itself, so this screen just points them back there.
 */
export function RegisterScreen({ name }: Props) {
  return (
    <div className="register">
      <div className="register-logo">🎲</div>
      <h1 className="register-title">Almost there{name && name !== 'Player' ? `, ${name}` : ''}!</h1>
      <p className="register-sub">You need to register before you can play.</p>

      <div className="register-steps">
        <div className="step">
          <span className="step-no">1</span>
          <span>Go back to the bot chat</span>
        </div>
        <div className="step">
          <span className="step-no">2</span>
          <span>
            Tap <b>📝 Register</b>
          </span>
        </div>
        <div className="step">
          <span className="step-no">3</span>
          <span>
            Then tap <b>🎮 Play Game</b>
          </span>
        </div>
      </div>

      <button className="register-btn" onClick={tgClose}>
        Back to the bot
      </button>

      <p className="auth-debug">auth: {authDebug()}</p>
    </div>
  );
}
