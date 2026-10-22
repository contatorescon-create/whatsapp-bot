// Bot WhatsApp do ResconFi (Baileys). Roda no Fly.io (São Paulo) com a sessão guardada em disco (/data).
// Toda chamada exige a chave BOT_API_KEY (cabeçalho x-api-key) — sem ela ninguém envia mensagem
// nem vê o QR Code. O ResconFi manda a chave configurada na tela de WhatsApp.
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys')
const QRCode = require('qrcode')
const pino = require('pino')
const http = require('http')
const crypto = require('crypto')

const API_KEY = (process.env.BOT_API_KEY || '').trim()
const AUTH_DIR = process.env.AUTH_DIR || 'auth_info'
const LIMITE_CORPO = 25 * 1024 * 1024   // PDF em base64

let sock = null
let currentQR = null
let conectado = false

function chaveOk(req) {
    if (!API_KEY) return false   // sem chave configurada, nada é liberado
    const url = new URL(req.url, 'http://x')
    const enviada = req.headers['x-api-key'] || url.searchParams.get('key') || ''
    const a = Buffer.from(String(enviada)), b = Buffer.from(API_KEY)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function json(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(obj))
}

function lerCorpo(req) {
    return new Promise((resolve, reject) => {
        const partes = []; let tam = 0
        req.on('data', c => {
            tam += c.length
            if (tam > LIMITE_CORPO) { reject(new Error('corpo grande demais')); req.destroy() } else partes.push(c)
        })
        req.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(partes).toString() || '{}')) } catch (e) { reject(e) }
        })
        req.on('error', reject)
    })
}

const server = http.createServer(async (req, res) => {
    const caminho = new URL(req.url, 'http://x').pathname

    if (caminho === '/' && req.method === 'GET') {   // checagem de saúde (Fly e ResconFi)
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        return res.end('Bot WhatsApp rodando!')
    }
    if (!chaveOk(req)) return json(res, 401, { error: 'chave inválida' })

    if (caminho === '/status' && req.method === 'GET') {
        return json(res, 200, { conectado, aguardando_qr: !!currentQR })
    }
    if (caminho === '/qr' && req.method === 'GET') {
        if (!currentQR) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            return res.end(`<html><body style="font-family:sans-serif;padding:40px">${conectado ? 'WhatsApp já conectado.' : 'Aguardando QR Code… recarregue em alguns segundos.'}</body></html>`)
        }
        const qrImage = await QRCode.toDataURL(currentQR)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        return res.end(`<html><head><meta http-equiv="refresh" content="20"></head><body style="background:#000;display:flex;justify-content:center;align-items:center;height:100vh"><img src="${qrImage}" style="width:300px"/></body></html>`)
    }
    if (req.method === 'POST' && (caminho === '/send' || caminho === '/send-pdf')) {
        if (!sock || !conectado) return json(res, 503, { error: 'WhatsApp desconectado — leia o QR Code em /qr' })
        try {
            const d = await lerCorpo(req)
            const numero = String(d.number || '').replace(/\D/g, '')
            if (numero.length < 10) return json(res, 400, { error: 'número inválido' })
            const jid = numero + '@s.whatsapp.net'
            if (caminho === '/send') {
                await sock.sendMessage(jid, { text: String(d.message || '') })
            } else {
                await sock.sendMessage(jid, {
                    document: Buffer.from(String(d.base64 || ''), 'base64'),
                    mimetype: 'application/pdf',
                    fileName: d.filename || 'documento.pdf',
                    caption: d.caption || ''
                })
            }
            return json(res, 200, { success: true })
        } catch (e) {
            return json(res, 500, { error: e.message })
        }
    }
    json(res, 404, { error: 'rota não encontrada' })
})

server.listen(process.env.PORT || 3000, () => console.log(`Bot ouvindo na porta ${process.env.PORT || 3000}`))
if (!API_KEY) console.warn('ATENÇÃO: BOT_API_KEY não definida — envios e QR bloqueados')

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
    sock = makeWASocket({ auth: state, printQRInTerminal: false, logger: pino({ level: 'silent' }) })

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update
        if (qr) {
            currentQR = qr
            console.log('QR Code disponível em /qr?key=...')
        }
        if (connection === 'close') {
            conectado = false
            const codigo = lastDisconnect?.error?.output?.statusCode
            if (codigo === DisconnectReason.loggedOut) {   // desconectado pelo celular: apaga a sessão e gera QR novo
                console.log('Sessão encerrada no celular — leia o QR Code de novo em /qr')
                try { require('fs').rmSync(AUTH_DIR, { recursive: true, force: true }) } catch (e) { /* segue */ }
            }
            setTimeout(connectToWhatsApp, codigo === DisconnectReason.loggedOut ? 2000 : 5000)
        } else if (connection === 'open') {
            currentQR = null
            conectado = true
            console.log('WhatsApp conectado!')
        }
    })
    sock.ev.on('creds.update', saveCreds)
}

connectToWhatsApp()
