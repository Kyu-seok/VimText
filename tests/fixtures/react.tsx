// E2E fixture: a React 19 controlled input, the reference Controlled Field.
// Bundled by tools/build.mjs into tests/fixtures/react.js (gitignored) and
// loaded by react.html. DOM ids are the contract the e2e specs rely on:
//   #in       the controlled <input> (Single-line Field under test)
//   #state    React's state for the input, rendered beside it
//   #renders  how many times the component has rendered
//   #mount    the input's current React key (bumped by #remount)
//   #rerender forces a state round-trip without touching the input's value
//   #remount  changes the input's key, so React replaces the element
//   #readonly toggles the input's readOnly attribute
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";

function Fixture() {
  const [text, setText] = useState("the quick brown fox");
  const [, setTick] = useState(0);
  const [mount, setMount] = useState(1);
  const [readOnly, setReadOnly] = useState(false);
  const renders = useRef(0);
  renders.current += 1;

  return (
    <>
      <p>
        <input
          id="in"
          key={mount}
          type="text"
          value={text}
          readOnly={readOnly}
          onChange={(e) => setText(e.target.value)}
        />
      </p>
      <p>
        state: <output id="state">{text}</output>
      </p>
      <p>
        renders: <span id="renders">{renders.current}</span> mount: <span id="mount">{mount}</span>
      </p>
      <p>
        <button id="rerender" type="button" onClick={() => setTick((t) => t + 1)}>
          re-render
        </button>
        <button id="remount" type="button" onClick={() => setMount((m) => m + 1)}>
          remount
        </button>
        <button id="readonly" type="button" onClick={() => setReadOnly((r) => !r)}>
          {readOnly ? "clear readOnly" : "set readOnly"}
        </button>
      </p>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
