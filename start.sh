git pull
npm i
npm run build
mkdir -p Microsoft-Rewards-Script/dist/browser/sessions
cp -r sessions/. Microsoft-Rewards-Script/dist/browser/sessions/
npm run start