FROM node:24-bookworm-slim
WORKDIR /app
RUN npm install --omit=dev --no-audit --no-fund @actual-app/api@26.10.0
COPY main.cjs plan.cjs report.cjs funding-model.cjs web-ui.cjs config.example.cjs ./
CMD ["node", "main.cjs"]

