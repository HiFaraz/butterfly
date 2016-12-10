DONE recursively define proxies - this can catch new properties that were not get/set before
DONE two way data binding!!!!
DONE don't pollute the namespace!
DONE why is create running after the first synctoviews in mapbindings? >> because it needs access to the proxy for async. at least we sync the rest of the data right away
DONE remove templateURL support - templates should be packed in production, so there should not be anything to go against that. Agree with Vue.js on this.

do I need a virtual dom??

if I don't have a match on a select, I should select a blank

handle promises as data values

respond to changes in watcher (create another proxy, and a map of paths to actual nodes as well as the binders) - what did I mean by this?

catch new live values added by new root data object

also work on contenteditable objects

run watchers and live values in parallel? consider
run watchers and live values in web workers? consider

name textbox cursor should not move then i release the mouse, check if the watcher/binder has changed the value before pushing the update 