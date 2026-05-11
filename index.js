require('dotenv').config()

const express = require('express')
const axios = require('axios')
const path = require('path')

const app = express()

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const SHEET_ID = process.env.SHEET_ID
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL
const OPEN_FINANCE_TOKEN = process.env.OPEN_FINANCE_TOKEN

// ─────────────────────────────────────────────
// LER ABA DA PLANILHA
// ─────────────────────────────────────────────

async function lerAba(nomeAba) {

  const url =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${nomeAba}`

  const resposta = await axios.get(url)

  const linhas = resposta.data.trim().split('\n')

  const cabecalho =
    linhas[0]
      .split(',')
      .map(c =>
        c
          .replace(/"/g, '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '_')
      )

  return linhas.slice(1).map(linha => {

    const valores =
      linha.split(',').map(v => v.replace(/"/g, '').trim())

    const obj = {}

    cabecalho.forEach((coluna, i) => {
      obj[coluna] =
        isNaN(valores[i])
          ? valores[i]
          : Number(valores[i])
    })

    return obj

  })

}

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────

app.post('/login', async (req, res) => {

  try {

    const { email, senha } = req.body

    const usuarios = await lerAba('usuarios')

    const usuario = usuarios.find(
      u =>
        u.email === email &&
        String(u.senha) === String(senha)
    )

    if (!usuario) {
      return res.status(401).json({
        erro: 'Email ou senha inválidos'
      })
    }

    res.json({
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email
    })

  } catch (e) {
    res.status(500).json({ erro: e.message })
  }

})

// ─────────────────────────────────────────────
// CRIAR CONTA
// ─────────────────────────────────────────────

app.post('/criar-conta', async (req, res) => {

  try {

    const {
      nome,
      cpf,
      email,
      telefone,
      senha,
      renda_mensal,
      despesas_mensais
    } = req.body

    if (!nome || !cpf || !email || !telefone || !senha || !renda_mensal) {
      return res.status(400).json({
        erro: 'Preencha todos os campos'
      })
    }

    if (String(cpf).replace(/\D/g, '').length !== 11) {
      return res.status(400).json({
        erro: 'CPF inválido'
      })
    }

    if (String(telefone).replace(/\D/g, '').length !== 11) {
      return res.status(400).json({
        erro: 'Telefone inválido'
      })
    }

    const resposta = await axios.post(
      GOOGLE_SCRIPT_URL,
      {
        acao: 'criarConta',
        nome,
        cpf,
        email,
        telefone,
        senha,
        renda_mensal: Number(renda_mensal),
        despesas_mensais: Number(despesas_mensais) || 0
      }
    )

    res.json({
      success: true,
      id: resposta.data.id,
      nome,
      score: resposta.data.score,
      numero_conta: resposta.data.numero_conta
    })

  } catch (e) {
    res.status(500).json({ erro: e.message })
  }

})

// ─────────────────────────────────────────────
// LISTAR USUÁRIOS
// ─────────────────────────────────────────────

app.get('/usuarios', async (req, res) => {

  try {

    const usuarios = await lerAba('usuarios')

    const resultado = usuarios.map(u => ({
      id: u.id,
      nome: u.nome
    }))

    res.json(resultado)

  } catch (e) {
    res.status(500).json({ erro: e.message })
  }

})

// ─────────────────────────────────────────────
// SALDO
// ─────────────────────────────────────────────

app.get('/saldo/:id', async (req, res) => {

  try {

    const contas = await lerAba('contas')

    const conta = contas.find(
      c => c.usuario_id === Number(req.params.id)
    )

    if (!conta) {
      return res.status(404).json({
        erro: 'Conta não encontrada'
      })
    }

    res.json(conta)

  } catch (e) {
    res.status(500).json({ erro: e.message })
  }

})

// ─────────────────────────────────────────────
// EXTRATO
// ─────────────────────────────────────────────

app.get('/extrato/:id', async (req, res) => {

  try {

    const transacoes = await lerAba('transacoes')

    const extrato = transacoes.filter(
      t => t.conta_id === Number(req.params.id)
    )

    res.json(extrato)

  } catch (e) {
    res.status(500).json({ erro: e.message })
  }

})

// ─────────────────────────────────────────────
// PERFIL FINANCEIRO
// ─────────────────────────────────────────────

app.get('/perfil/:id', async (req, res) => {

  try {

    const perfil = await lerAba('perfil_financeiro')

    const usuario = perfil.find(
      p => p.usuario_id === Number(req.params.id)
    )

    if (!usuario) {
      return res.status(404).json({
        erro: 'Perfil não encontrado'
      })
    }

    res.json(usuario)

  } catch (e) {
    res.status(500).json({ erro: e.message })
  }

})

// ─────────────────────────────────────────────
// SOLICITAR EMPRÉSTIMO (COM FILA E OPEN FINANCE)
// ─────────────────────────────────────────────

const filaEmprestimos = [];
const statusEmprestimos = new Map();
let idPedidoCounter = 1;
let processandoFila = false;

async function processarFila() {
  if (processandoFila || filaEmprestimos.length === 0) return;
  processandoFila = true;

  while (filaEmprestimos.length > 0) {
    const pedido = filaEmprestimos.shift();
    
    statusEmprestimos.set(pedido.id_pedido, { status: 'em_analise' });

    try {
      // Simula o tempo de análise do Open Finance (3 segundos)
      await new Promise(r => setTimeout(r, 3000));

      const resposta = await axios.post(
        GOOGLE_SCRIPT_URL,
        {
          acao: 'emprestimo',
          usuario_id: Number(pedido.usuario_id),
          valor_solicitado: Number(pedido.valor_solicitado)
        }
      );

      statusEmprestimos.set(pedido.id_pedido, { 
        status: 'concluido', 
        resultado: resposta.data 
      });
    } catch (e) {
      statusEmprestimos.set(pedido.id_pedido, { 
        status: 'erro', 
        erro: e.message 
      });
    }
  }

  processandoFila = false;
}

app.post('/solicitar-emprestimo', async (req, res) => {

  try {

    const { usuario_id, valor_solicitado } = req.body

    const id_pedido = idPedidoCounter++;

    statusEmprestimos.set(id_pedido, { status: 'na_fila', posicao: filaEmprestimos.length + 1 });

    filaEmprestimos.push({
      id_pedido,
      usuario_id,
      valor_solicitado
    });

    processarFila(); // processa em background sem travar a requisição

    res.json({ id_pedido, status: 'na_fila' })

  } catch (e) {
    res.status(500).json({ erro: e.message })
  }

})

app.get('/status-emprestimo/:id_pedido', (req, res) => {
  const id_pedido = Number(req.params.id_pedido);
  
  if (!statusEmprestimos.has(id_pedido)) {
    return res.status(404).json({ erro: 'Pedido não encontrado' });
  }

  const info = statusEmprestimos.get(id_pedido);

  if (info.status === 'na_fila') {
    const posicao = filaEmprestimos.findIndex(p => p.id_pedido === id_pedido) + 1;
    return res.json({ ...info, posicao });
  }

  res.json(info);
})

// ─────────────────────────────────────────────
// CONSENTIMENTO OPEN FINANCE
// ─────────────────────────────────────────────

app.post('/consentimento/autorizar', async (req, res) => {

  try {

    const { usuario_id } = req.body

    const resposta = await axios.post(
      GOOGLE_SCRIPT_URL,
      {
        acao: 'autorizarConsentimento',
        usuario_id: Number(usuario_id)
      }
    )

    if (resposta.data.erro) {
      return res.status(400).json({
        erro: resposta.data.erro
      })
    }

    res.json({ success: true })

  } catch (e) {
    res.status(500).json({ erro: e.message })
  }

})

// ─────────────────────────────────────────────
// OPEN FINANCE
// ─────────────────────────────────────────────

app.get('/open-finance/:id', async (req, res) => {

  try {

    const token = req.headers.authorization

    if (token !== OPEN_FINANCE_TOKEN) {
      return res.status(401).json({
        erro: 'Token inválido'
      })
    }

    const id = Number(req.params.id)

    const consentimentos = await lerAba('consentimentos')

    const consentimento = consentimentos.find(
      c =>
        c.usuario_id === id &&
        c.status === 'autorizado'
    )

    if (!consentimento) {
      return res.status(403).json({
        erro: 'Usuário não autorizou Open Finance'
      })
    }

    const [
      usuarios,
      contas,
      perfil,
      emprestimos
    ] = await Promise.all([
      lerAba('usuarios'),
      lerAba('contas'),
      lerAba('perfil_financeiro'),
      lerAba('emprestimos')
    ])

    const usuario = usuarios.find(u => u.id === id)
    const conta = contas.find(c => c.usuario_id === id)
    const perfilFinanceiro = perfil.find(p => p.usuario_id === id)
    const historicoEmprestimos = emprestimos.filter(e => e.usuario_id === id)

    res.json({
      nome: usuario.nome,
      saldo: conta.saldo,
      agencia: conta.agencia,
      numero_conta: conta.numero_conta,
      score: perfilFinanceiro.score,
      renda_mensal: perfilFinanceiro.renda_mensal,
      despesas_mensais: perfilFinanceiro.despesas_mensais,
      emprestimos: historicoEmprestimos
    })

  } catch (e) {
    res.status(500).json({ erro: e.message })
  }

})

// ─────────────────────────────────────────────

app.listen(process.env.PORT, () => {
  console.log(`✅ Banco A rodando em http://localhost:${process.env.PORT}`)
})