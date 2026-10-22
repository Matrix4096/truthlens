import { motion, useReducedMotion } from "framer-motion";

const PATH_STEPS = [
  {
    number: "01",
    title: "待核查说法",
    detail: "明确问题与语境",
    position: "claim",
  },
  {
    number: "02",
    title: "寻找来源",
    detail: "回到信息出处",
    position: "source",
  },
  {
    number: "03",
    title: "交叉验证",
    detail: "比对不同证据",
    position: "check",
  },
  {
    number: "04",
    title: "形成结论",
    detail: "呈现依据与局限",
    position: "verdict",
  },
];

/** A schematic of the process, not a sample verification result. */
export default function EditorialHero() {
  const reducedMotion = useReducedMotion();

  function goToDesk() {
    const desk = document.getElementById("verification-desk");
    desk?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
    desk?.focus({ preventScroll: true });
  }

  return (
    <section className="tl-hero" aria-labelledby="tl-home-title">
      <div className="tl-shell tl-hero-grid">
        <div className="tl-hero-copy">
          <p className="tl-eyebrow">
            <span className="tl-brand-rule" aria-hidden="true" />
            TRUTH LENS / 真相透镜
          </p>
          <h1
            className="tl-hero-title"
            id="tl-home-title"
            aria-label="真相透镜"
          >
            <span className="tl-title-mask" aria-hidden="true">
              <motion.span
                initial={reducedMotion ? false : { y: "105%" }}
                animate={{ y: 0 }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              >
                真相透镜
              </motion.span>
            </span>
          </h1>
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.55,
              delay: 0.12,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <p className="tl-hero-statement">让判断，有据可循。</p>
            <p className="tl-hero-description">
              从一条说法出发，寻找可追溯的来源，交叉比对证据。
              <br className="tl-desktop-break" />
              让结论带着依据，回到你的判断之中。
            </p>
            <a
              className="tl-start-link"
              href="#verification-desk"
              data-no-transition
              onClick={event => {
                event.preventDefault();
                goToDesk();
              }}
            >
              开始核查 <span aria-hidden="true">↗</span>
            </a>
            <p className="tl-hero-note">公开网络证据 · 自主接入模型</p>
          </motion.div>
        </div>

        <motion.figure
          className="tl-evidence-map"
          initial={reducedMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.15 }}
          aria-labelledby="tl-path-caption"
        >
          <figcaption className="tl-map-caption" id="tl-path-caption">
            <span>核查路径</span>
            <span className="tl-map-caption-note">流程示意</span>
          </figcaption>
          <div className="tl-map-board">
            <svg
              className="tl-map-lines"
              viewBox="0 0 440 360"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path className="tl-map-guide" d="M214 16V344M16 180H424" />
              <motion.path
                className="tl-map-route"
                d="M190 46H202Q214 46 214 58V123Q214 135 226 135H230 M230 135H220Q208 135 208 147V212Q208 224 196 224H190 M190 224H202Q214 224 214 236V301Q214 313 226 313H230"
                initial={reducedMotion ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.15, delay: 0.35, ease: "easeInOut" }}
              />
              <circle className="tl-map-junction" cx="214" cy="90" r="3" />
              <circle className="tl-map-junction" cx="208" cy="180" r="3" />
              <circle className="tl-map-junction" cx="214" cy="270" r="3" />
            </svg>
            <ol className="tl-path-list">
              {PATH_STEPS.map((step, index) => (
                <motion.li
                  key={step.position}
                  className={`tl-path-node tl-path-node-${step.position}`}
                  initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: 0.25 + index * 0.12 }}
                >
                  <span className="tl-path-number" aria-hidden="true">
                    {step.number}
                  </span>
                  <div>
                    <span className="tl-path-title">{step.title}</span>
                    <span className="tl-path-detail">{step.detail}</span>
                  </div>
                </motion.li>
              ))}
            </ol>
          </div>
          <p className="tl-map-note">结论可追溯，判断有空间。</p>
        </motion.figure>
      </div>
      <div className="tl-shell tl-hero-baseline" aria-hidden="true">
        <span>从问题开始</span>
        <span>循证而行 ↓</span>
      </div>
    </section>
  );
}
