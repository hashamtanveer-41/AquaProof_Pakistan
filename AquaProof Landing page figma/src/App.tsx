import { GitBranch } from 'lucide-react'
import { CONTACT_URL, DEMO_URL, REPO_URL } from './story/config'
import { DemoLink, Journey } from './story/Journey'

export default function App() {
  return (
    <>
      <Journey />
      <About />
    </>
  )
}

const TEAM = [
  ['Asfand', 'Backend, mapping and AI'],
  ['Hasham', 'Scientific engine and weather'],
  ['Hamza', 'Frontend and UI'],
  ['Talal', 'Research and presentation'],
  ['Sarim', 'Testing and validation'],
]

function About() {
  return (
    <section className="info" id="about" aria-labelledby="about-title">
      <div className="wrap">
        <header className="info-head">
          <h2 id="about-title">One field record for every irrigation decision.</h2>
          <p className="info-lede">
            A survey of six farmers in Pakistan helped shape AquaProof’s focus on when to run the tubewell and when to harvest around rain.
          </p>
        </header>

        <div className="status" id="demo">
          <section aria-labelledby="demo-title">
            <h3 id="demo-title">From field map to WhatsApp</h3>
            <ol className="walk">
              <li>Map the field. Live forecasts and a daily FAO-56 soil-water balance estimate how much water the crop needs.</li>
              <li>Send field-specific advice on WhatsApp. Verified farmers can ask questions in Urdu, Roman Urdu or English.</li>
              <li>Review farmer-reported irrigation before adding it to the field history.</li>
            </ol>
          </section>
          <section aria-labelledby="planned-title">
            <h3 id="planned-title">Reaching farmers on basic phones</h3>
            <p>SMS is the next step so farmers with basic phones or limited mobile internet can receive advisories wherever cellular service is available.</p>
          </section>
        </div>

        <div className="demo">
          <div>
            <h3>How we’d measure impact</h3>
            <p>A field pilot would track how much groundwater farmers pump and whether crops still get the water they need.</p>
          </div>
          <div className="demo-cta">
            {DEMO_URL && <DemoLink tone="light" />}
            <a className="repo" href={REPO_URL} target="_blank" rel="noopener noreferrer">
              <GitBranch size={16} aria-hidden="true" /> View the code on GitHub
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            {CONTACT_URL && (
              <a className="contact" href={CONTACT_URL}>
                Contact the team
              </a>
            )}
          </div>
        </div>

        <section className="team" aria-labelledby="team-title">
          <h3 id="team-title">The team</h3>
          <ul>
            {TEAM.map(([n, r]) => (
              <li key={n}>
                <strong>{n}</strong>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="foot">
          <a href="#top" onClick={() => window.scrollTo({ top: 0 })}>
            Back to top
          </a>
        </footer>
      </div>
    </section>
  )
}
