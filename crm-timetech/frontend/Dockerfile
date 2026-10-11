FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache libc6-compat tzdata

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG NEXT_PUBLIC_LINKEDIN_CRAWLER_API_URL
ARG NEXT_PUBLIC_LINKEDIN_CRAWLER_API_KEY
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_LINKEDIN_CRAWLER_API_URL=${NEXT_PUBLIC_LINKEDIN_CRAWLER_API_URL}
ENV NEXT_PUBLIC_LINKEDIN_CRAWLER_API_KEY=${NEXT_PUBLIC_LINKEDIN_CRAWLER_API_KEY}
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=${NEXT_PUBLIC_GOOGLE_CLIENT_ID}

RUN npm run build
RUN mkdir -p public

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    TZ=Asia/Ho_Chi_Minh

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1002 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
