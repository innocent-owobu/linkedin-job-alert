# 🔔 Lightweight LinkedIn Job Alert Pipeline

An automated, serverless, low-competition job tracking and alert pipeline. Specifically tailored to search for target **Data Analyst** and **BI / Power BI** roles across **Germany**, filter them based on strict applicant count boundaries, track state transitions dynamically via **Upstash Redis (Vercel KV)**, and deliver real-time notifications to **Telegram**.

Deployable on **Vercel's free Hobby plan** and powered by free external cron scheduling (**cron-job.org**).

---

## 🛠️ Pipeline Architecture & How It Works

Stateless serverless functions on Vercel run under tight execution limits (e.g., 10 seconds for Hobby plans). Because Bright Data crawls can take several minutes to compile, this pipeline is split into **two separate, asynchronous stages** running sequentially with a buffer delay:

```
[cron-job.org] (HH:00) 
       ➔ [POST /api/trigger] ➔ Triggers Bright Data Job search ➔ Saves Snapshot ID to Upstash Redis

[cron-job.org] (HH:08) 
       ➔ [POST /api/check-alerts] ➔ Downloads results ➔ Filters jobs & evaluates state ➔ Sends Telegram alerts ➔ Clears snap from Redis
```

---

## 📋 Exact Applicant Filtering & State Transition Logic

The alerting mechanism is designed to prioritze fresh, low-competition listings while maintaining strict de-duplication:

1. **LOW COMPETITION (Alertable)**: `Applicant count <= 15` (inclusive) triggers an alert.
2. **UNKNOWN FRESH (Alertable)**: No applicant count shown AND job is posted `within the last 2 hours` triggers an alert.
3. **UNKNOWN OLD (No Alert)**: No applicant count shown AND job is `older than 2 hours` does **NOT** trigger an alert.
4. **MID RANGE (No Alert)**: `Applicant count between 16 and 100` (inclusive) does **NOT** trigger initial alerts.
5. **HIGH RANGE (No Alert)**: `Applicant count > 100` never triggers an alert under any circumstance.
6. **DE-DUPLICATION**: Alerts are sent on each job **exactly once** to prevent spamming your chat hourly.
7. **TRANSITION EXCEPTION (Follow-up Alerts)**: If a job's applicant count crosses between the `<='15'` band and the `'16-100'` band in either direction, a follow-up alert is sent showing the status change (e.g. low-competition job crossed to moderate, or vice versa).

---

## 🚀 Step-by-Step Configuration Guide

### 1. Bright Data Setup
1. Log in to your [Bright Data Console](https://brightdata.com).
2. Go to **Datasets & Scrapers** and select the **LinkedIn Jobs dataset** ("discover by keyword").
3. Generate your **API Key** and copy your **Dataset ID**.

### 2. Telegram Bot Setup
1. Open Telegram, search for `@BotFather`, and start a conversation.
2. Send `/newbot` and follow instructions to name your bot and get the **Bot API Token**.
3. Create a group or channel, add your bot as an administrator, and find your **Chat ID** (forward a message from the channel to `@RawDataBot` to inspect the JSON metadata and retrieve the numeric channel/chat ID starting with `-100`).

### 3. Upstash Redis / Vercel KV Setup
1. Log in to [Upstash](https://upstash.com) and create a free Redis database.
2. Copy the **REST URL** and **REST Token** under the HTTP REST credentials section.

### 4. Deploy to Vercel
1. Push your repository to GitHub or run `vercel deploy` via the Vercel CLI.
2. Go to your Vercel Project Dashboard ➔ **Settings** ➔ **Environment Variables**.
3. Configure the following environmental variables:
   ```env
   BRIGHT_DATA_API_KEY="your_bright_data_api_key"
   BRIGHT_DATA_DATASET_ID="your_dataset_id"
   TELEGRAM_BOT_TOKEN="your_bot_token"
   TELEGRAM_CHAT_ID="your_chat_id"
   UPSTASH_REDIS_URL="your_upstash_redis_rest_url"
   UPSTASH_REDIS_TOKEN="your_upstash_redis_rest_token"
   SHARED_SECRET="select_any_secure_string_here"
   ```

### 5. Configure cron-job.org Schedules
Vercel Hobby cron schedules natively support only once-a-day intervals. Configure free, highly-precise hourly schedules on [cron-job.org](https://cron-job.org):

* **Cron Job A: Trigger (Step 1)**:
  * **URL**: `https://your-vercel-project.vercel.app/api/trigger`
  * **Method**: `POST`
  * **Headers**: Add key `Authorization` with value `Bearer your_shared_secret_here`
  * **Schedule**: User-defined hourly between 6 AM and 8 PM local time (e.g. `0 6-20/1 * * *` on cron syntax).
* **Cron Job B: Check & Alert (Step 2)**:
  * **URL**: `https://your-vercel-project.vercel.app/api/check-alerts`
  * **Method**: `POST`
  * **Headers**: Add key `Authorization` with value `Bearer your_shared_secret_here`
  * **Schedule**: Set to run **8 minutes past every hour** between 6 AM and 8 PM (e.g., `8 6-20/1 * * *` on cron syntax). This provides an 8-minute buffer for Bright Data asynchronously completing crawler searches before we pull them.

---

## 🧪 Interactive Live Testing & Verification

The included **Boundary Test Suite** built directly into the local dashboard tests all specific edge cases, including:
* **Exactly 15 applicants** (Inclusive low-competition alert).
* **Exactly 100 applicants** (Middle range boundary).
* **Unknown count under 2 hours vs over 2 hours** (Fresh post alert vs old post silence).
* **"Over 100 people clicked Apply" string** (Hard ceiling ceiling validation).
* **"12 applicants" string** (Standard parsing validation).
* **LOW ➔ MID transition** (Follow-up alert crossing trigger).
* **MID ➔ LOW transition** (Follow-up alert crossing trigger).

### Running Tests:
Open the dashboard preview tab, navigate to **Boundary Tests**, and click **Run All Tests** to observe the real-time parsing, evaluation, and logging engine in full action!
