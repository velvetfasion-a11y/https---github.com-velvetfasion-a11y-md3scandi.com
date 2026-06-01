// MD3Hero.jsx
// Replace the IMAGE_* constants with your actual hosted image URLs

const IMAGE_FASHION = "/images/fashion-set.jpg";       // printed co-ord set
const IMAGE_SHOE    = "/images/heel-brown.jpg";         // brown slingback heel
const IMAGE_LAMP1   = "/images/ceiling-spot-lamp.jpg";  // wire cage ceiling lamp
const IMAGE_LAMP2   = "/images/bud-table-lamp.jpg";     // mushroom bud lamp

const Sparkle = ({ size = 16, delay = 0, style = {} }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    style={{
      animation: `sparkle 2.4s ease-in-out ${delay}s infinite`,
      ...style,
    }}
  >
    <path
      d="M12 2L13.5 10.5L22 12L13.5 13.5L12 22L10.5 13.5L2 12L10.5 10.5Z"
      fill="#B89A5A"
    />
  </svg>
);

export default function MD3Hero() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Jost:wght@200;300;400&display=swap');

        .md3-hero * { box-sizing: border-box; margin: 0; padding: 0; }

        .md3-hero {
          font-family: 'Jost', sans-serif;
          background: #F7F3EC;
          color: #1E1C1A;
          width: 100%;
          min-height: 100vh;
          display: grid;
          grid-template-columns: 38% 1fr 30%;
          align-items: center;
          overflow: hidden;
          position: relative;
        }

        /* ── LEFT ── */
        .md3-left {
          position: relative;
          height: 100vh;
          overflow: hidden;
        }
        .md3-left::after {
          content: '';
          position: absolute;
          top: 15%; bottom: 15%; right: 0;
          width: 1px;
          background: linear-gradient(to bottom, transparent, rgba(184,154,90,0.25), transparent);
        }
        .md3-fashion-img {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: top center;
          filter: contrast(1.02) saturate(0.95);
          animation: md3FadeLeft 1s 0.3s both;
        }
        .md3-shoe-img {
          position: absolute;
          bottom: 28px;
          right: -16px;
          width: 150px;
          height: 120px;
          object-fit: contain;
          filter: drop-shadow(0 12px 32px rgba(0,0,0,0.18));
          z-index: 4;
          transform: rotate(-8deg);
          animation: md3FadeUp 1s 1.1s both;
        }

        /* ── CENTER ── */
        .md3-center {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 60px 32px;
          height: 100%;
          position: relative;
          z-index: 5;
        }
        .md3-tag {
          font-size: 9px;
          letter-spacing: 0.42em;
          text-transform: uppercase;
          color: #B89A5A;
          font-weight: 300;
          margin-bottom: 28px;
          animation: md3FadeDown 0.9s 0.6s both;
        }
        .md3-headline {
          font-family: 'Cormorant Garamond', serif;
          font-weight: 300;
          font-size: clamp(44px, 5.5vw, 78px);
          color: #1E1C1A;
          line-height: 1.05;
          letter-spacing: 0.02em;
          animation: md3FadeUp 1s 0.7s both;
        }
        .md3-headline em {
          font-style: italic;
          display: block;
        }
        .md3-rule {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 28px auto 32px;
          width: 100%;
          max-width: 220px;
          animation: md3FadeIn 1s 1s both;
        }
        .md3-rule::before,
        .md3-rule::after {
          content: '';
          flex: 1;
          height: 1px;
          background: #B89A5A;
          opacity: 0.4;
        }
        .md3-rule-diamond {
          width: 5px;
          height: 5px;
          border: 1px solid #B89A5A;
          border-radius: 50%;
          transform: rotate(45deg);
          flex-shrink: 0;
        }
        .md3-sub {
          font-size: 11px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: #7A756D;
          font-weight: 300;
          margin-bottom: 40px;
          animation: md3FadeUp 0.9s 1.1s both;
        }
        .md3-ctas {
          display: flex;
          flex-direction: column;
          gap: 12px;
          width: 100%;
          max-width: 240px;
          animation: md3FadeUp 0.9s 1.25s both;
        }
        .md3-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 13px 24px;
          text-decoration: none;
          font-family: 'Jost', sans-serif;
          font-size: 9.5px;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          font-weight: 300;
          border: 1px solid rgba(30,28,26,0.2);
          color: #1E1C1A;
          background: transparent;
          cursor: pointer;
          transition: background 0.4s, border-color 0.4s, color 0.4s;
          position: relative;
          overflow: hidden;
        }
        .md3-btn::before {
          content: '';
          position: absolute;
          inset: 0;
          background: #1E1C1A;
          transform: translateX(-101%);
          transition: transform 0.45s cubic-bezier(0.23,1,0.32,1);
        }
        .md3-btn:hover::before { transform: translateX(0); }
        .md3-btn:hover { color: #F7F3EC; border-color: #1E1C1A; }
        .md3-btn span,
        .md3-btn svg { position: relative; z-index: 1; }
        .md3-btn svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.4; flex-shrink: 0; }
        .md3-btn-gold {
          background: #B89A5A;
          border-color: #B89A5A;
          color: #fff;
        }
        .md3-btn-gold::before { background: #8B7238; }
        .md3-btn-gold:hover { color: #fff; border-color: #8B7238; }

        .md3-badge {
          position: absolute;
          bottom: 40px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          align-items: center;
          gap: 8px;
          animation: md3FadeIn 1s 1.8s both;
        }
        .md3-badge-line { width: 24px; height: 1px; background: rgba(184,154,90,0.4); }
        .md3-badge-text {
          font-size: 7.5px;
          letter-spacing: 0.35em;
          text-transform: uppercase;
          color: rgba(184,154,90,0.6);
          white-space: nowrap;
        }

        /* ── RIGHT ── */
        .md3-right {
          position: relative;
          height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 40px;
          padding: 60px 44px 60px 16px;
          animation: md3FadeRight 1.1s 0.5s both;
          z-index: 2;
        }
        .md3-blob-card {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 28px;
        }
        .md3-blob-card:last-child { align-self: flex-end; margin-right: 10px; }
        .md3-blob {
          border-radius: 50%;
          background: #F5EDD4;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          transition: transform 0.5s ease, box-shadow 0.5s ease;
          box-shadow: 0 8px 40px rgba(184,154,90,0.1);
        }
        .md3-blob:hover {
          transform: scale(1.04);
          box-shadow: 0 16px 56px rgba(184,154,90,0.2);
        }
        .md3-blob-lg { width: 210px; height: 210px; }
        .md3-blob-sm { width: 158px; height: 158px; background: #EDE2C4; }
        .md3-blob img {
          width: 82%; height: 82%;
          object-fit: contain;
          filter: drop-shadow(0 6px 16px rgba(0,0,0,0.12));
          transition: transform 0.5s ease;
        }
        .md3-blob:hover img { transform: scale(1.06) translateY(-4px); }
        .md3-blob-label {
          position: absolute;
          bottom: -22px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 8px;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: #7A756D;
          white-space: nowrap;
          font-weight: 300;
        }

        /* Sparkle positions */
        .md3-sp { position: absolute; pointer-events: none; }
        .md3-blob-card:first-child .md3-sp:nth-child(1) { top: -14px; right: 22px; }
        .md3-blob-card:first-child .md3-sp:nth-child(2) { top: 12px; right: -12px; }
        .md3-blob-card:first-child .md3-sp:nth-child(3) { bottom: -4px; right: 0; }
        .md3-blob-card:last-child  .md3-sp:nth-child(1) { bottom: -8px; left: 10px; }
        .md3-blob-card:last-child  .md3-sp:nth-child(2) { bottom: 18px; left: -14px; }
        .md3-blob-card:last-child  .md3-sp:nth-child(3) { top: -4px; left: 22px; }

        /* ── ANIMATIONS ── */
        @keyframes md3FadeDown  { from{opacity:0;transform:translateY(-14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes md3FadeUp    { from{opacity:0;transform:translateY(18px)}  to{opacity:1;transform:translateY(0)} }
        @keyframes md3FadeIn    { from{opacity:0} to{opacity:1} }
        @keyframes md3FadeLeft  { from{opacity:0;transform:translateX(-24px)} to{opacity:1;transform:translateX(0)} }
        @keyframes md3FadeRight { from{opacity:0;transform:translateX(24px)}  to{opacity:1;transform:translateX(0)} }
        @keyframes sparkle {
          0%,100% { opacity:0.5; transform:scale(0.9) rotate(0deg); }
          50%      { opacity:1;   transform:scale(1.2) rotate(15deg); }
        }

        @media (max-width: 900px) {
          .md3-hero { grid-template-columns: 1fr; min-height: auto; }
          .md3-left { height: 60vw; }
          .md3-right { flex-direction: row; height: auto; padding: 40px 24px; }
          .md3-blob-lg { width: 140px; height: 140px; }
          .md3-blob-sm { width: 110px; height: 110px; }
        }
      `}</style>

      <section className="md3-hero">

        {/* LEFT: Fashion image */}
        <div className="md3-left">
          <img className="md3-fashion-img" src={IMAGE_FASHION} alt="Fashion collection" />
          <img className="md3-shoe-img"    src={IMAGE_SHOE}    alt="Sculptural heel" />
        </div>

        {/* CENTER: Headline + CTAs */}
        <div className="md3-center">
          <p className="md3-tag">Curated lifestyle store</p>

          <h1 className="md3-headline">
            Your world,<em>elevated.</em>
          </h1>

          <div className="md3-rule">
            <div className="md3-rule-diamond" />
          </div>

          <p className="md3-sub">Fashion · Footwear · Living</p>

          <div className="md3-ctas">
            <a className="md3-btn md3-btn-gold" href="#">
              <svg viewBox="0 0 24 24">
                <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
              </svg>
              <span>Fashion Collection</span>
            </a>
            <a className="md3-btn" href="#">
              <svg viewBox="0 0 24 24">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              <span>Home Collection</span>
            </a>
          </div>

          <div className="md3-badge">
            <div className="md3-badge-line" />
            <span className="md3-badge-text">MD3 · Est. 2025 · Stockholm</span>
            <div className="md3-badge-line" />
          </div>
        </div>

        {/* RIGHT: Product blobs */}
        <div className="md3-right">

          {/* Blob 1: Ceiling lamp */}
          <div className="md3-blob-card">
            <Sparkle size={18} delay={0}   className="md3-sp" style={{position:'absolute',top:-14,right:22}} />
            <Sparkle size={11} delay={0.8} className="md3-sp" style={{position:'absolute',top:12,right:-12}} />
            <Sparkle size={7}  delay={1.6} className="md3-sp" style={{position:'absolute',bottom:-4,right:0}} />
            <div className="md3-blob md3-blob-lg">
              <img src={IMAGE_LAMP1} alt="Ceiling spot lamp" />
            </div>
            <span className="md3-blob-label">Lighting</span>
          </div>

          {/* Blob 2: Table lamp */}
          <div className="md3-blob-card">
            <Sparkle size={16} delay={0}   className="md3-sp" style={{position:'absolute',bottom:-8,left:10}} />
            <Sparkle size={9}  delay={0.8} className="md3-sp" style={{position:'absolute',bottom:18,left:-14}} />
            <Sparkle size={6}  delay={1.6} className="md3-sp" style={{position:'absolute',top:-4,left:22}} />
            <div className="md3-blob md3-blob-sm">
              <img src={IMAGE_LAMP2} alt="Bud table lamp" />
            </div>
            <span className="md3-blob-label">Home Decor</span>
          </div>

        </div>

      </section>
    </>
  );
}
