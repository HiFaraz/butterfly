virtual dom

DONE recursively define proxies - this can catch new properties that were not get/set before

if I don't have a match on a select, I should select a blank

DONE don't pollute the namespace!

handle promises as data values

DONE two way data binding!!!!

respond to changes in watcher (create another proxy, and a map of paths to actual nodes as well as the binders) - what did I mean by this?

catch new live values added by new root data object

also work on contenteditable objects

why is create running after the first synctoviews in mapbindings? >> because it needs access to the proxy for async. at least we sync the rest of the data right away

run watchers and live values in parallel? consider
run watchers and live values in web workers? consider