"use strict";
(function (root) {
  function render(record, escapeHTML, heading = "h3") {
    function section(label, credits, roles, empty) {
      const list = credits?.length ? `<ul>${credits.map(person => `<li>${escapeHTML(person.name)}${person[roles]?.length
        ? ` — ${escapeHTML(person[roles].join(", "))}` : ""}</li>`).join("")}</ul>` : `<p>${empty}</p>`;
      return `<section><${heading}>${label}</${heading}>${list}</section>`;
    }
    return `<div class="movie-credits">
      ${section("Cast", record.cast, "characters", "No cast credits available.")}
      ${section("Writers", record.writers, "jobs", "No writing credits available.")}
    </div>`;
  }
  root.AnivizMovieCredits = { render };
})(globalThis);
