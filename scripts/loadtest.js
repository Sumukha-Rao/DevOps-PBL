// k6 stress test for the URL shortener.
// Run: k6 run scripts/loadtest.js, or docker run --rm -i grafana/k6 run - < scripts/loadtest.js
// TARGETS: comma-separated base URLs, e.g. http://app:8000 (Compose) or http://$(minikube ip) (Ingress)
// HOST: optional Host header, e.g. shortener.test when TARGETS is the Ingress IP
// PROFILE: "ramp" (10 -> 50 -> 100 VUs) or "spike" (straight to 300 VUs)
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const TARGETS = (__ENV.TARGETS || 'http://app:8000').split(',');
const HOST = __ENV.HOST ? { Host: __ENV.HOST } : {};
const PROFILES = {
  ramp: [
    { duration: '30s', target: 10 },
    { duration: '45s', target: 50 },
    { duration: '45s', target: 100 },
    { duration: '30s', target: 100 },
    { duration: '15s', target: 0 },
  ],
  spike: [
    { duration: '10s', target: 300 },
    { duration: '60s', target: 300 },
    { duration: '10s', target: 0 },
  ],
};

export const options = {
  scenarios: { load: { executor: 'ramping-vus', startVUs: 0, stages: PROFILES[__ENV.PROFILE || 'ramp'], gracefulRampDown: '5s' } },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

const statuses = {};
for (const s of ['201', '307', '500', '502', '503', '0', 'other']) statuses[s] = new Counter(`status_${s}`);
const count = (res) => (statuses[String(res.status)] || statuses.other).add(1);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function setup() {
  const codes = [];
  for (let i = 0; i < 200; i++) {
    const res = http.post(`${TARGETS[0]}/api/links`, JSON.stringify({ url: `https://example.com/seed/${i}` }),
      { headers: { 'Content-Type': 'application/json', ...HOST } });
    if (res.status === 201) codes.push(res.json('code'));
  }
  if (codes.length === 0) throw new Error('setup could not create any links');
  return { codes };
}

export default function ({ codes }) {
  const base = pick(TARGETS);
  if (Math.random() < 0.8) {
    const res = http.get(`${base}/s/${pick(codes)}`, { redirects: 0, headers: HOST, tags: { name: 'redirect' } });
    count(res);
    check(res, { 'redirect 307': (r) => r.status === 307 });
  } else {
    const res = http.post(`${base}/api/links`, JSON.stringify({ url: `https://example.com/load/${__VU}/${__ITER}` }),
      { headers: { 'Content-Type': 'application/json', ...HOST }, tags: { name: 'create' } });
    count(res);
    check(res, { 'create 201': (r) => r.status === 201 });
  }
}
