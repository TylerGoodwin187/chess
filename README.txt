SETUP
=====

1. Put your piece PNGs (pw.png, pb.png, nw.png, nb.png, bw.png, bb.png,
   rw.png, rb.png, qw.png, qb.png, kw.png, kb.png) directly in this
   "maia-app" folder, next to index.html.

2. Copy these folders/files over from your maia-platform-frontend repo
   into this "maia-app" folder (open Command Prompt in maia-app and run,
   adjusting the source path if your repo is elsewhere):

   mkdir maia3
   copy C:\Users\letst\maia-platform-frontend\public\maia3\maia3_simplified.onnx maia3\

   mkdir ort
   copy C:\Users\letst\maia-platform-frontend\public\ort\*.* ort\

   copy C:\Users\letst\maia-platform-frontend\public\maia-worker.js .

   mkdir data
   copy C:\Users\letst\maia-platform-frontend\src\lib\engine\data\all_moves_maia3.json data\
   copy C:\Users\letst\maia-platform-frontend\src\lib\engine\data\all_moves_maia3_reversed.json data\

   When done, maia-app should look like:

   maia-app/
     index.html
     app.js
     maia-engine.js
     maia-tensor.js
     maia-worker.js
     pw.png, pb.png, nw.png, nb.png, bw.png, bb.png, rw.png, rb.png, qw.png, qb.png, kw.png, kb.png
     maia3/
       maia3_simplified.onnx
     ort/
       ort-wasm-simd-threaded.mjs
       ort-wasm-simd-threaded.wasm
       ort.wasm.min.js
     data/
       all_moves_maia3.json
       all_moves_maia3_reversed.json

3. This has to be served over http://, not opened directly as a file
   (Workers and fetch() are blocked on file:// URLs). Use whatever you
   already use for your other chess PWA (e.g. VS Code Live Server), or
   from Command Prompt inside maia-app:

   npx serve .

   then open the printed localhost URL in your browser.

WHAT HAPPENS ON FIRST LOAD
===========================
The Maia model is 45MB, so the very first load will show a
"Downloading Maia model... X%" status while it fetches. After that it's
cached in IndexedDB by maia-worker.js, so future loads should be fast.

NEXT STEPS (once this works)
==============================
- Wire up the Resign / Draw / Flip buttons from the mockup
- Add the move history row, clocks, and move history list
- Merge this styling with the dropdown menu animations we built earlier
