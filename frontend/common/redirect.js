"use strict";

// Keep existing GitHub Pages bookmarks such as /#creators working.
const pages = new Set(["intro", "story", "reception", "content", "creators", "recommendations", "explorer"]);
const chapter = location.hash.slice(1);
const page = pages.has(chapter) ? chapter : "intro";
location.replace(new URL(`../${page}/index.html${location.search}`, document.currentScript.src));
