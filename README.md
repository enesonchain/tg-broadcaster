# 🤖 Telegram Bot Broadcaster

A fast, safe, and free web application for broadcasting messages to multiple Telegram groups and channels using the official Bot API.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-15-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)

## ✨ Features

- **⚡ Fast Broadcasting** - Send up to 30 messages per second
- **🛡️ Safe** - Uses official Bot API, no account risk
- **💰 Free** - No costs, no limits on bot creation
- **🎨 Modern UI** - Beautiful, responsive design
- **📝 Rich Text** - Support for HTML and Markdown formatting
- **🔔 Silent Mode** - Option to send without notifications
- **🔒 Protected Content** - Prevent forwarding and saving
- **📊 Real-time Logs** - Track all broadcast activity
- **💾 Persistent Storage** - Chats saved in browser

## 🚀 Quick Start

### 1. Create a Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Deploy

#### Option A: Vercel (Recommended)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/telegram-bot-broadcaster)

#### Option B: Local Development

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/telegram-bot-broadcaster.git
cd telegram-bot-broadcaster

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Add Your Bot to Chats

**For Channels:**
1. Add your bot as an administrator to the channel
2. In the app, add the channel using `@channelname` or channel ID

**For Groups:**
1. Add your bot to the group
2. Get the group ID (use [@userinfobot](https://t.me/userinfobot))
3. In the app, add the group using its ID

**For Users:**
1. User must first start a conversation with your bot
2. Get their user ID and add it in the app

## 📖 Usage

1. **Connect** - Paste your bot token and connect
2. **Add Chats** - Add channels, groups, or users
3. **Select** - Choose which chats to broadcast to
4. **Compose** - Write your message (supports HTML/Markdown)
5. **Send** - Broadcast to all selected chats

## ⚙️ Message Formatting

### HTML (Recommended)
```html
<b>Bold</b>
<i>Italic</i>
<u>Underline</u>
<s>Strikethrough</s>
<code>Inline code</code>
<pre>Code block</pre>
<a href="https://example.com">Link</a>
```

### Markdown
```markdown
**Bold**
_Italic_
`Inline code`
```code block```
[Link](https://example.com)
```

## 🔒 Security

- ✅ All data stored locally in your browser
- ✅ Bot token never sent to any external server
- ✅ API calls go directly to Telegram
- ✅ Open source - verify the code yourself

## 📊 Rate Limits

| Type | Limit |
|------|-------|
| Messages (different chats) | 30/second |
| Messages (same chat) | 1/second |
| Messages to groups | 20/minute per group |

The app automatically handles rate limiting with batch processing.

## 🛠️ Tech Stack

- **Framework:** Next.js 15
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Font:** Geist
- **API:** Telegram Bot API

## 📝 Environment Variables

No environment variables required! Everything runs client-side.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - feel free to use this project for any purpose.

## ⚠️ Disclaimer

This tool is for legitimate broadcasting purposes only. Please respect Telegram's Terms of Service and do not use for spam or harassment.

---

Made with ❤️ for the Telegram community
