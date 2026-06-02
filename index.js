const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys')
const QRCode = require('qrcode')
const pino = require('pino')
const http = require('http')
const fs = require('fs')

let sock = null
let currentQR = null

const server = http.createServer(async (req, res) => {
    if (req.url === '/qr' && currentQR) {
        const qrImage = await QRCode.toDataURL(currentQR)
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<html><body style="background:#000;display:flex;justify-content:center;align-items:center;height:100vh"><img src="${qrImage}" style="width:300px"/></body></html>`)

    } else if (req.method === 'POST' && req.url === '/send') {
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', async () => {
            try {
                const { number, message } = JSON.parse(body)
                const jid = number + '@s.whatsapp.net'
                await sock.sendMessage(jid, { text: message })
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: true }))
            } catch (e) {
                res.writeHead(500)
                res.end(JSON.stringify({ error: e.message }))
            }
        })

    } else if (req.method === 'POST' && req.url === '/send-pdf') {
        let body = []
        req.on('data', chunk => body.push(chunk))
        req.on('end', async () => {
            try {
                const data = JSON.parse(Buffer.concat(body).toString())
                const { number, filename, base64, caption } = data
                const jid = number + '@s.whatsapp.net'
                const buffer = Buffer.from(base64, 'base64')
                await sock.sendMessage(jid, {
                    document: buffer,
                    mimetype: 'application/pdf',
                    fileName: filename || 'documento.pdf',
                    caption: caption || ''
                })
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: true }))
            } catch (e) {
                res.writeHead(500)
                res.end(JSON.stringify({ error: e.message }))
            }
        })

    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('Bot WhatsApp rodando!')
    }
})

server.listen(process.env.PORT || 3000)

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info')
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    })

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update
        if (qr) {
            currentQR = qr
            console.log('QR Code disponível em /qr')
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
            if (shouldReconnect) connectToWhatsApp()
        } else if (connection === 'open') {
            currentQR = null
            console.log('WhatsApp conectado!')
        }
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0]
        if (!msg.key.fromMe && msg.message) {
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
            if (text.toLowerCase() === 'oi') {
                await sock.sendMessage(msg.key.remoteJid, { text: 'Olá! Sou um bot automático 🤖' })
            }
        }
    })
}

connectToWhatsApp()
