const codes = `npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put DATABASE_URL
npx wrangler secret put REDIS_URL
npx wrangler secret put USER_FULL_NAME
npx wrangler secret put USER_EMAIL
npx wrangler secret put USER_PHONE
npx wrangler secret put cvNAME
npx wrangler secret put CV_PATH
npx wrangler secret put SAPO_AUTH_EMAIL
npx wrangler secret put SAPO_AUTH_PASSWORD
npx wrangler secret put NUMBER_OF_JOB_APPLIES_PER_KEYWORD_PER_DAY
npx wrangler secret put DIRECT_URL`;

console.log(codes.split('\n').map(code => code.trim().split(' ')[3]));