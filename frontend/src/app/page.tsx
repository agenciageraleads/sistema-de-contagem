"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import styles from "./page.module.css";
import { Icons } from "@/components/Icons";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";
const FRONTEND_BUILD_MARKER = "2026-08-10-client-diagnostics";

interface User {
  id: number;
  nome: string;
  login: string;
  role: "OPERADOR" | "SUPERVISOR" | "ADMIN";
  codusuSankhya?: number | null;
}

interface ItemFila {
  id: number;
  codprod: number;
  codlocal?: number;
  codemp?: number;
  descprod: string;
  marca?: string;
  unidade?: string;
  controle?: string;
  codigoBarrasCadastro?: string | null;
  codigosBarrasValidos?: string[];
  prioridadeManual?: number;
  motivoPriorizacao?: string | null;
  priorizadoPor?: number | null;
  priorizador?: { id: number; nome: string; login: string } | null;
  status?: string;
}

interface OpStats {
  nome: string;
  assertividade: number;
  total: number;
  metaIndividual: number;
}

interface SupervisorStats {
  resumo: {
    totalContado: number;
    divergenciasPendentes: number;
    valorEmFalta: number;
    valorEmSobra: number;
    assertividadeGlobal: number;
    metaGlobalDiaria: number;
    progressoGlobal: number;
  };
  rankingOperadores: OpStats[];
}

interface Divergencia {
  id: number;
  contagem: {
    codprod: number;
    codemp: number;
    codlocal: number;
    qtdContada: number;
    esperadoNoMomento: number;
    divergencia: number;
    divergenciaPercent: number;
    tipo: string;
    user: { nome: string };
    snapshot?: { descprod: string, marca?: string, controle?: string };
  };
  severidade: string;
  status: string;
  adjustStatus?: string | null;
  adjustNoteId?: number | null;
  observacoes?: string;
  movimentacoes?: any;
  saldoAjustado?: number;
  createdAt: string;
}

interface CopiaEstoqueItem {
  codprod: number;
  descprod: string;
  codemp: number;
  codlocal: number;
  descrlocal?: string | null;
  controle?: string | null;
  codvol?: string | null;
  codigoBarrasCadastro?: string | null;
  qtdCopiada: number;
  dataCopia?: string | null;
  statusFila?: string | null;
  priorizadoPor?: number | null;
}

interface ProdutoSeparacao {
  sequencia: number;
  codprod: number;
  descprod: string;
  qtdneg: number;
  codvol: string;
  controle: string;
  codigoBarrasCadastro: string;
  localizacao: string;
}

interface MotoristaSpoke {
  id: string;
  name?: string | null;
  displayName?: string | null;
  active: boolean;
}

interface Entrega {
  id: number;
  numeroPedido: string;
  clienteNome: string;
  telefone?: string | null;
  enderecoTexto: string;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  googleMapsUrl?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  pagamento?: string | null;
  observacoes?: string | null;
  motoristaSpokeId?: string | null;
  motoristaNome?: string | null;
  planSpokeId?: string | null;
  routeSpokeId?: string | null;
  stopSpokeId?: string | null;
  trackingLink?: string | null;
  webAppLink?: string | null;
  status: string;
  statusDetalhe?: string | null;
  createdAt: string;
}

interface EntregaImportada {
  numeroPedido: string;
  clienteNome: string;
  telefone: string;
  enderecoTexto: string;
  bairro: string;
  cidade: string;
  uf: string;
  googleMapsUrl: string;
  pagamento: string;
  observacoes: string;
}

type ModuloApp = "hub" | "contagem" | "entregas" | "administracao" | "operador";

const getHojeLocalIso = () => {
  const agora = new Date();
  const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const MODULOS_LOGIN: Array<{
  id: Exclude<ModuloApp, "hub">;
  icon: string;
  titulo: string;
  descricao: string;
  acesso: string;
}> = [
  {
    id: "contagem",
    icon: "📊",
    titulo: "Módulo Contagem",
    descricao: "Dashboard, fila e relatórios de auditoria.",
    acesso: "Admin e supervisor",
  },
  {
    id: "entregas",
    icon: "🚚",
    titulo: "Módulo Entregas",
    descricao: "Mensagens, rotas e distribuição na Spoke.",
    acesso: "Admin e supervisor",
  },
  {
    id: "administracao",
    icon: "👥",
    titulo: "Módulo Administração",
    descricao: "Usuários, cargos, acessos e códigos Sankhya.",
    acesso: "Admin e supervisor",
  },
  {
    id: "operador",
    icon: "🧾",
    titulo: "Módulo Operador",
    descricao: "Funções Contagem e Separação.",
    acesso: "Operador e supervisor",
  },
];

const TECLAS_QUANTIDADE = [
  "7",
  "8",
  "9",
  "backspace",
  "4",
  "5",
  "6",
  "clear",
  "1",
  "2",
  "3",
  "decimal",
  "0",
  "00",
] as const;

const formatarQuantidadeDigitada = (valor: string) => {
  const limpo = valor.replace(/[^0-9.,]/g, "").replace(/\./g, ",");
  const partes = limpo.split(",");
  const inteiro = partes[0].replace(/^0+(?=\d)/, "");

  if (partes.length === 1) {
    return inteiro;
  }

  const decimal = partes.slice(1).join("").slice(0, 4);
  return `${inteiro || "0"},${decimal}`;
};

const quantidadeParaNumero = (valor: string) =>
  Number(valor.replace(/\./g, "").replace(",", "."));

const garantirLista = <T,>(valor: unknown): T[] => (Array.isArray(valor) ? valor : []);

const normalizarCodigoBarras = (codigo: string) => codigo.trim();
const normalizarApenasDigitos = (codigo: string) => codigo.replace(/\D/g, "");

const isGtinValido = (codigo: string) => {
  if (!/^\d+$/.test(codigo) || ![8, 12, 13, 14].includes(codigo.length)) {
    return false;
  }

  const digitos = codigo.split("").map(Number);
  const verificador = digitos.pop();
  if (verificador === undefined) return false;

  let soma = 0;
  for (let i = digitos.length - 1, posicao = 0; i >= 0; i -= 1, posicao += 1) {
    soma += digitos[i] * (posicao % 2 === 0 ? 3 : 1);
  }

  return (10 - (soma % 10)) % 10 === verificador;
};

const extrairCodigosBarras = (codigo: string) => {
  const limpo = normalizarApenasDigitos(codigo);
  if (!limpo) return [];
  if (isGtinValido(limpo)) return [limpo];

  for (const tamanho of [13, 14, 12, 8]) {
    if (limpo.length > tamanho && limpo.length % tamanho === 0) {
      const partes = limpo.match(new RegExp(`.{1,${tamanho}}`, "g")) || [];
      if (partes.length > 1 && partes.every((parte) => parte.length === tamanho)) {
        return Array.from(new Set(partes));
      }
    }
  }

  if (limpo.length > 14 && limpo.length % 2 === 0) {
    const metade = limpo.length / 2;
    const primeiraParte = limpo.slice(0, metade);
    const segundaParte = limpo.slice(metade);
    if (primeiraParte === segundaParte) return [primeiraParte];
  }

  if (limpo.length <= 14) return [limpo];

  const codigosEncontrados: string[] = [];
  for (const tamanho of [14, 13, 12, 8]) {
    for (let i = 0; i <= limpo.length - tamanho; i += 1) {
      const candidato = limpo.slice(i, i + tamanho);
      if (isGtinValido(candidato)) {
        codigosEncontrados.push(candidato);
      }
    }
  }

  if (codigosEncontrados.length > 0) {
    return Array.from(new Set(codigosEncontrados));
  }

  return [limpo];
};

export default function Home() {
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState("");

  // Navegação / módulos
  const [moduloAtivo, setModuloAtivo] = useState<ModuloApp>("hub");
  const [moduloLogin, setModuloLogin] = useState<Exclude<ModuloApp, "hub">>("operador");
  const [abaAtiva, setAbaAtiva] = useState<"dashboard" | "config" | "fila" | "direcionada" | "usuarios" | "relatorios" | "entregas">("dashboard");

  // Estados Operador
  const [itemAtual, setItemAtual] = useState<ItemFila | null>(null);
  const [qtd, setQtd] = useState("");
  const quantidadeInputRef = useRef<HTMLInputElement | null>(null);
  const codigoBarrasContagemInputRef = useRef<HTMLInputElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraScanLoopRef = useRef<number | null>(null);
  const [codigoBarrasContagem, setCodigoBarrasContagem] = useState("");
  const [mostrarTecladoQuantidade, setMostrarTecladoQuantidade] = useState(false);
  const [filaDirecionadaOperador, setFilaDirecionadaOperador] = useState<ItemFila[]>([]);
  const [showFilaDirecionadaOperador, setShowFilaDirecionadaOperador] = useState(false);
  const [loadingFilaDirecionada, setLoadingFilaDirecionada] = useState(false);
  const [cameraCodigoBarrasAberta, setCameraCodigoBarrasAberta] = useState(false);
  const [cameraCodigoBarrasErro, setCameraCodigoBarrasErro] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [statsOperador, setStatsOperador] = useState<any>(null);
  const [metaBatida, setMetaBatida] = useState(false);
  const [showModalReportar, setShowModalReportar] = useState(false);
  const [motivoReporte, setMotivoReporte] = useState("");
  const [viewMode, setViewMode] = useState<"MENU" | "CONTAGEM" | "SEPARACAO">("MENU");

  // Estados Separação
  const [separacaoNunota, setSeparacaoNunota] = useState("");
  const [separacaoBox, setSeparacaoBox] = useState("");
  const [produtosSeparacao, setProdutosSeparacao] = useState<ProdutoSeparacao[]>([]);
  const [nunotaProdutosCarregada, setNunotaProdutosCarregada] = useState<number | null>(null);
  const [itensValidadosSeparacao, setItensValidadosSeparacao] = useState<Record<string, boolean>>({});
  const [itensRejeitadosSeparacao, setItensRejeitadosSeparacao] = useState<Record<string, boolean>>({});
  const [itemSelecionadoSeparacao, setItemSelecionadoSeparacao] = useState<string | null>(null);
  const [codigoBarrasLido, setCodigoBarrasLido] = useState("");
  const [feedbackSeparacao, setFeedbackSeparacao] = useState("");
  const scannerInputRef = useRef<HTMLInputElement | null>(null);
  const scanBufferRef = useRef("");
  const scanLastKeyTsRef = useRef(0);
  const scanFlushTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const nunotaAtual = Number(separacaoNunota);
    if (!separacaoNunota || !Number.isFinite(nunotaAtual) || nunotaAtual !== nunotaProdutosCarregada) {
      setProdutosSeparacao([]);
      setNunotaProdutosCarregada(null);
      setItensValidadosSeparacao({});
      setItensRejeitadosSeparacao({});
      setItemSelecionadoSeparacao(null);
      setCodigoBarrasLido("");
      setFeedbackSeparacao("");
    }
  }, [separacaoNunota, nunotaProdutosCarregada]);

  const getProdutoSeparacaoKey = useCallback(
    (produto: ProdutoSeparacao) => `${produto.sequencia}-${produto.codprod}`,
    [],
  );

  const totalItensSeparacao = produtosSeparacao.length;
  const totalItensValidadosSeparacao = useMemo(
    () => produtosSeparacao.filter((produto) => itensValidadosSeparacao[getProdutoSeparacaoKey(produto)]).length,
    [produtosSeparacao, itensValidadosSeparacao, getProdutoSeparacaoKey],
  );
  const todosItensValidadosSeparacao = totalItensSeparacao > 0 && totalItensValidadosSeparacao === totalItensSeparacao;

  const getProdutoImagemUrl = (codprod: number) =>
    `${API_URL}/separacao/produto-imagem/${codprod}`;

  const codigosBarrasItemAtual = useMemo(() => {
    if (!itemAtual) return [];

    const codigos = [
      itemAtual.codigoBarrasCadastro,
      ...(itemAtual.codigosBarrasValidos || []),
    ]
      .flatMap((codigo) => extrairCodigosBarras(String(codigo || "")))
      .filter(Boolean);

    return Array.from(new Set(codigos));
  }, [itemAtual]);

  const codigoBarrasContagemNormalizado = normalizarApenasDigitos(codigoBarrasContagem);
  const itemAtualSemCodigoBarras = !!itemAtual && codigosBarrasItemAtual.length === 0;
  const codigoBarrasContagemValido =
    !!codigoBarrasContagemNormalizado &&
    codigosBarrasItemAtual.includes(codigoBarrasContagemNormalizado);
  const quantidadeContagemHabilitada =
    !!itemAtual && !itemAtualSemCodigoBarras && codigoBarrasContagemValido;

  const resetarEntradaContagem = useCallback(() => {
    setQtd("");
    setCodigoBarrasContagem("");
    setMostrarTecladoQuantidade(false);
    setCameraCodigoBarrasErro("");
  }, []);

  const aplicarTeclaQuantidade = (tecla: (typeof TECLAS_QUANTIDADE)[number]) => {
    if (!quantidadeContagemHabilitada) return;

    setQtd((valorAtual) => {
      if (tecla === "clear") return "";
      if (tecla === "backspace") return valorAtual.slice(0, -1);
      if (tecla === "decimal") {
        return valorAtual.includes(",") ? valorAtual : `${valorAtual || "0"},`;
      }
      return formatarQuantidadeDigitada(`${valorAtual}${tecla}`);
    });
    quantidadeInputRef.current?.focus();
  };

  useEffect(() => {
    if (!itemAtual?.id) return;
    resetarEntradaContagem();
    window.setTimeout(() => codigoBarrasContagemInputRef.current?.focus(), 80);
  }, [itemAtual?.id, resetarEntradaContagem]);

  useEffect(() => {
    if (quantidadeContagemHabilitada) return;
    setMostrarTecladoQuantidade(false);
    setQtd("");
  }, [quantidadeContagemHabilitada]);

  useEffect(() => {
    if (codigoBarrasContagemValido && error.startsWith("EAN")) {
      setError("");
    }
  }, [codigoBarrasContagemValido, error]);

  useEffect(() => {
    if (!cameraCodigoBarrasAberta) return;

    let ativo = true;

    const pararCamera = () => {
      if (cameraScanLoopRef.current) {
        window.cancelAnimationFrame(cameraScanLoopRef.current);
        cameraScanLoopRef.current = null;
      }
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => track.stop());
        cameraStreamRef.current = null;
      }
    };

    const iniciarCamera = async () => {
      const BarcodeDetectorClass = (window as any).BarcodeDetector;
      if (!BarcodeDetectorClass) {
        setCameraCodigoBarrasErro("Este navegador não liberou leitura automática pela câmera. Use bipagem ou digitação.");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraCodigoBarrasErro("Câmera indisponível neste navegador.");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (!ativo) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        cameraStreamRef.current = stream;
        const video = cameraVideoRef.current;
        if (!video) return;

        video.srcObject = stream;
        await video.play();

        const detector = new BarcodeDetectorClass({
          formats: ["ean_13", "ean_8", "code_128", "code_39", "itf", "upc_a", "upc_e"],
        });

        const detectar = async () => {
          if (!ativo || !cameraVideoRef.current) return;
          try {
            if (cameraVideoRef.current.readyState >= 2) {
              const resultados = await detector.detect(cameraVideoRef.current);
              const leitura = resultados?.[0]?.rawValue;
              if (leitura) {
                const codigoLido = normalizarApenasDigitos(String(leitura));
                setCodigoBarrasContagem(codigoLido);
                setCameraCodigoBarrasAberta(false);
                if (codigosBarrasItemAtual.includes(codigoLido)) {
                  setError("");
                  window.setTimeout(() => quantidadeInputRef.current?.focus(), 80);
                } else {
                  setError("EAN lido não confere com o produto selecionado.");
                  window.setTimeout(() => codigoBarrasContagemInputRef.current?.focus(), 80);
                }
                return;
              }
            }
          } catch (err) {
            console.error(err);
          }
          cameraScanLoopRef.current = window.requestAnimationFrame(detectar);
        };

        detectar();
      } catch {
        setCameraCodigoBarrasErro("Não foi possível abrir a câmera. Verifique a permissão do navegador.");
      }
    };

    iniciarCamera();

    return () => {
      ativo = false;
      pararCamera();
    };
  }, [cameraCodigoBarrasAberta, codigosBarrasItemAtual]);

  const validarCodigoBarrasItemSelecionado = useCallback((codigoOverride?: string) => {
    if (!itemSelecionadoSeparacao) {
      setError("Selecione um item para validar.");
      return;
    }

    const produtoSelecionado = produtosSeparacao.find(
      (produto) => getProdutoSeparacaoKey(produto) === itemSelecionadoSeparacao,
    );
    if (!produtoSelecionado) {
      setError("Item selecionado não encontrado.");
      return;
    }

    const codigoLido = normalizarCodigoBarras(
      typeof codigoOverride === "string" ? codigoOverride : codigoBarrasLido,
    );
    if (!codigoLido) {
      setError("Leia ou digite o código de barras para validar.");
      return;
    }

    const codigoCadastro = normalizarCodigoBarras(produtoSelecionado.codigoBarrasCadastro || "");
    if (!codigoCadastro) {
      setFeedbackSeparacao(`Produto ${produtoSelecionado.codprod} sem código de barras cadastrado no Sankhya.`);
      setItensValidadosSeparacao((prev) => ({ ...prev, [itemSelecionadoSeparacao]: false }));
      setItensRejeitadosSeparacao((prev) => ({ ...prev, [itemSelecionadoSeparacao]: true }));
      return;
    }

    const codigoLidoDigitos = normalizarApenasDigitos(codigoLido);
    const codigoCadastroDigitos = normalizarApenasDigitos(codigoCadastro);

    const ehIgual =
      codigoLido === codigoCadastro ||
      (codigoLidoDigitos.length > 0 &&
        codigoCadastroDigitos.length > 0 &&
        codigoLidoDigitos === codigoCadastroDigitos);

    if (ehIgual) {
      setItensValidadosSeparacao((prev) => ({ ...prev, [itemSelecionadoSeparacao]: true }));
      setItensRejeitadosSeparacao((prev) => ({ ...prev, [itemSelecionadoSeparacao]: false }));
      setFeedbackSeparacao(`Item ${produtoSelecionado.codprod} validado com sucesso.`);
      setError("");
      setCodigoBarrasLido("");
    } else {
      setItensValidadosSeparacao((prev) => ({ ...prev, [itemSelecionadoSeparacao]: false }));
      setItensRejeitadosSeparacao((prev) => ({ ...prev, [itemSelecionadoSeparacao]: true }));
      setFeedbackSeparacao(`Código rejeitado para o item ${produtoSelecionado.codprod}.`);
      setCodigoBarrasLido("");
    }
  }, [itemSelecionadoSeparacao, produtosSeparacao, getProdutoSeparacaoKey, codigoBarrasLido]);

  useEffect(() => {
    const separacaoAtiva =
      viewMode === "SEPARACAO" &&
      moduloAtivo === "operador" &&
      (user?.role === "OPERADOR" || user?.role === "SUPERVISOR" || user?.role === "ADMIN") &&
      !!itemSelecionadoSeparacao &&
      nunotaProdutosCarregada === Number(separacaoNunota) &&
      produtosSeparacao.length > 0;

    if (!separacaoAtiva) return;

    const flushScanBuffer = (validarAutomaticamente: boolean) => {
      const leitura = scanBufferRef.current.trim();
      if (!leitura) return;
      setCodigoBarrasLido(leitura);
      if (validarAutomaticamente) {
        validarCodigoBarrasItemSelecionado(leitura);
      }
      scanBufferRef.current = "";
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const scannerInput = scannerInputRef.current;
      const target = event.target as HTMLElement | null;
      const digitadoNoCampoScanner = !!scannerInput && target === scannerInput;

      if (digitadoNoCampoScanner) return;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const agora = Date.now();
      if (agora - scanLastKeyTsRef.current > 120) {
        scanBufferRef.current = "";
      }
      scanLastKeyTsRef.current = agora;

      if (event.key === "Enter" || event.key === "Tab") {
        flushScanBuffer(true);
        event.preventDefault();
        return;
      }

      if (event.key.length === 1) {
        scanBufferRef.current += event.key;
        if (scanFlushTimerRef.current) {
          window.clearTimeout(scanFlushTimerRef.current);
        }
        scanFlushTimerRef.current = window.setTimeout(() => {
          flushScanBuffer(false);
        }, 120);
      }
    };

    const onPaste = (event: ClipboardEvent) => {
      const texto = event.clipboardData?.getData("text")?.trim() || "";
      if (!texto) return;
      setCodigoBarrasLido(texto);
      validarCodigoBarrasItemSelecionado(texto);
      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("paste", onPaste);
      if (scanFlushTimerRef.current) {
        window.clearTimeout(scanFlushTimerRef.current);
        scanFlushTimerRef.current = null;
      }
    };
  }, [
    viewMode,
    moduloAtivo,
    user?.role,
    itemSelecionadoSeparacao,
    nunotaProdutosCarregada,
    separacaoNunota,
    produtosSeparacao.length,
    validarCodigoBarrasItemSelecionado,
  ]);

  // Estados Supervisor
  const [supStats, setSupStats] = useState<SupervisorStats | null>(null);
  const [divergencias, setDivergencias] = useState<Divergencia[]>([]);
  const [operadoresContagem, setOperadoresContagem] = useState<Array<Pick<User, "id" | "nome" | "login">>>([]);
  const [operadorRecontagem, setOperadorRecontagem] = useState<Record<number, string>>({});
  const [filaItems, setFilaItems] = useState<ItemFila[]>([]);
  const [copiaFiltro, setCopiaFiltro] = useState({
    data: getHojeLocalIso(),
    codemp: "1",
    codlocal: "10010000",
    sequencia: "1",
    busca: "",
  });
  const [copiaItens, setCopiaItens] = useState<CopiaEstoqueItem[]>([]);
  const [copiaSelecionados, setCopiaSelecionados] = useState<Record<string, boolean>>({});
  const [operadorDirecionado, setOperadorDirecionado] = useState("");
  const [prioridadeDirecionada, setPrioridadeDirecionada] = useState("9000");
  const [motivoDirecionado, setMotivoDirecionado] = useState("");
  const [metaGlobalEdit, setMetaGlobalEdit] = useState<number>(100);
  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [motoristasSpoke, setMotoristasSpoke] = useState<MotoristaSpoke[]>([]);
  const [mensagensEntrega, setMensagensEntrega] = useState("");
  const [formEntrega, setFormEntrega] = useState({
    numeroPedido: "",
    clienteNome: "",
    telefone: "",
    enderecoTexto: "",
    bairro: "",
    cidade: "Goiânia",
    uf: "GO",
    googleMapsUrl: "",
    pagamento: "",
    observacoes: "",
    motoristaSpokeId: "",
  });
  const getCopiaKey = useCallback(
    (item: Pick<CopiaEstoqueItem, "codprod" | "codemp" | "codlocal">) =>
      `${item.codemp}-${item.codlocal}-${item.codprod}`,
    [],
  );
  const copiaItensSelecionados = useMemo(
    () => copiaItens.filter((item) => copiaSelecionados[getCopiaKey(item)]),
    [copiaItens, copiaSelecionados, getCopiaKey],
  );
  const todosItensCopiaSelecionados =
    copiaItens.length > 0 && copiaItensSelecionados.length === copiaItens.length;

  // Estados Admin (Usuários)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [showModalUsuario, setShowModalUsuario] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [usuarioEdit, setUsuarioEdit] = useState<any>(null);
  const [formUsuario, setFormUsuario] = useState({
    nome: "",
    login: "",
    senha: "",
    role: "OPERADOR" as any,
    codusuSankhya: "",
  });


  // Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, senha }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message); return; }

      const role = data.user?.role as User["role"] | undefined;
      const temAcesso =
        (moduloLogin === "contagem" && (role === "ADMIN" || role === "SUPERVISOR")) ||
        (moduloLogin === "entregas" && (role === "ADMIN" || role === "SUPERVISOR")) ||
        (moduloLogin === "administracao" && (role === "ADMIN" || role === "SUPERVISOR")) ||
        (moduloLogin === "operador" && (role === "OPERADOR" || role === "SUPERVISOR"));

      if (!temAcesso) {
        setError("Seu usuário não tem acesso a este módulo.");
        return;
      }

      setToken(data.token);
      setUser(data.user);
      setModuloAtivo(moduloLogin);
      if (moduloLogin === "operador") {
        setViewMode("MENU");
      }
      if (moduloLogin === "contagem") {
        setAbaAtiva("dashboard");
      }
      if (moduloLogin === "entregas") {
        setAbaAtiva("entregas");
        carregarEntregas(data.token);
      }
      if (moduloLogin === "administracao") {
        setAbaAtiva("usuarios");
        carregarUsuarios(data.token);
      }
    } catch { setError("Falha na sincronização"); } finally { setLoading(false); }
  };

  const handleResetCycle = async () => {
    if (!window.confirm("ATENÇÃO: Isso limpará todos os itens CONCLUÍDOS e REPORTADOS da fila para iniciar um novo ciclo do zero. Deseja continuar?")) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/sankhya/reset-cycle`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (res.ok) {
        alert("Ciclo resetado com sucesso! A fila foi limpa e re-sincronizada.");
        carregarDadosSupervisor();
      }
    } catch { setError("Erro ao resetar ciclo"); } finally { setLoading(false); }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [itensReportados, setItensReportados] = useState<any[]>([]);
  const [lastSync, setLastSync] = useState<string>("");

  const handleLogout = () => {
    setUser(null);
    setItemAtual(null);
    setSupStats(null);
    window.location.reload(); // Força recarregamento para limpar estado visual
  };

  // --- LÓGICA OPERADOR ---
  const carregarStatsOperador = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/contagem/stats`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      const data = await res.json();
      setStatsOperador(data);
    } catch (e) { console.error(e); }
  }, [token]);

  const carregarFilaDirecionadaOperador = useCallback(async () => {
    if (!token) return;
    setLoadingFilaDirecionada(true);
    try {
      const res = await fetch(`${API_URL}/contagem/direcionada/minha-fila`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setFilaDirecionadaOperador(garantirLista<ItemFila>(data).filter(Boolean));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingFilaDirecionada(false);
    }
  }, [token]);

  const abrirFilaDirecionadaOperador = async () => {
    setShowFilaDirecionadaOperador(true);
    await carregarFilaDirecionadaOperador();
  };

  const selecionarItemDirecionadoOperador = async (filaId: number) => {
    setLoadingFilaDirecionada(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/contagem/direcionada/${filaId}/selecionar`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Não foi possível selecionar este item.");
        return;
      }
      setItemAtual(data);
      setShowFilaDirecionadaOperador(false);
      setViewMode("CONTAGEM");
      await carregarFilaDirecionadaOperador();
    } catch {
      setError("Erro ao selecionar item direcionado.");
    } finally {
      setLoadingFilaDirecionada(false);
    }
  };

  const buscarProximo = async () => {
    setLoading(true);
    resetarEntradaContagem();
    try {
      const res = await fetch(`${API_URL}/contagem/proximo`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const raw = await res.text();
      const data = raw ? JSON.parse(raw) : null;

      if (data?.id) {
        setItemAtual(data);
        setError("");
      } else {
        setItemAtual(null);
        setError("Não há itens pendentes para este operador no momento.");
      }
    } catch {
      setError("Erro ao buscar item");
    } finally { setLoading(false); }
  };

  const registrarContagem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemAtual) return;

    // Validação manual em vez de 'required' do HTML para evitar bloqueio de botões secundários
    const quantidadeInformada = quantidadeParaNumero(qtd);
    if (!qtd || isNaN(quantidadeInformada) || quantidadeInformada < 0) {
      setError("Por favor, informe uma quantidade válida.");
      return;
    }

    if (itemAtualSemCodigoBarras) {
      setError("Produto sem EAN cadastrado. Reporte o cadastro antes de confirmar a contagem.");
      return;
    }

    if (!codigoBarrasContagemValido) {
      setError("Leia o EAN cadastrado do produto antes de confirmar.");
      codigoBarrasContagemInputRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/contagem/registrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          filaId: itemAtual.id,
          qtd_contada: quantidadeInformada,
          codigo_barras_lido: codigoBarrasContagemNormalizado,
        }),
      });
      if (res.ok) {
        const statsRes = await fetch(`${API_URL}/contagem/stats`, {
          headers: { "Authorization": `Bearer ${token}` },
        });
        const newStats = await statsRes.json();
        setStatsOperador(newStats);
        // Celebração de meta: exibir apenas quando atinge pela 1ª vez
        if (newStats.concluido && !metaBatida) {
          setMetaBatida(true);
        }
        await carregarFilaDirecionadaOperador();
        await buscarProximo();
      } else {
        const errorData = await res.json();
        setError(errorData.message || "Erro no registro");
      }
    } catch (err) {
      console.error(err);
      setError("Erro de comunicação com o servidor");
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (moduloAtivo !== "operador" || viewMode !== "CONTAGEM" || !token) return;
    carregarFilaDirecionadaOperador();
  }, [moduloAtivo, viewMode, token, carregarFilaDirecionadaOperador]);

  const handleNaoAchei = async () => {
    if (!itemAtual) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/contagem/nao-achei/${itemAtual.id}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (res.ok) {
        await carregarStatsOperador();
        await carregarFilaDirecionadaOperador();
        await buscarProximo();
      } else {
        setError("Erro ao processar 'Não Achei'");
      }
    } catch (err) {
      console.error(err);
      setError("Erro de rede");
    } finally { setLoading(false); }
  };

  const handleReportarProblema = () => {
    if (!itemAtual) return;
    setMotivoReporte("");
    setShowModalReportar(true);
  };

  const confirmarReporte = async () => {
    if (!itemAtual) return;
    if (!motivoReporte.trim()) {
      setError("Por favor, descreva o problema antes de enviar.");
      return;
    }
    setLoading(true);
    setShowModalReportar(false);
    try {
      const res = await fetch(`${API_URL}/contagem/reportar-problema/${itemAtual.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ motivo: motivoReporte }),
      });
      if (res.ok) {
        await carregarStatsOperador();
        await carregarFilaDirecionadaOperador();
        await buscarProximo();
      } else {
        const errData = await res.json();
        setError(errData.message || "Erro ao reportar");
      }
    } catch {
      setError("Erro ao reportar");
    } finally {
      setLoading(false);
    }
  };

  // --- LÓGICA SEPARAÇÃO ---
  const handleSeparacaoAcao = async (acao: string) => {
    if (!separacaoNunota) {
      setError("Por favor, preencha o Nro Único da Nota (NUNOTA).");
      return;
    }
    if (!user?.codusuSankhya || Number(user.codusuSankhya) <= 0) {
      setError("Seu usuário não possui Código Sankhya cadastrado. Solicite o cadastro no menu de usuários.");
      return;
    }
    if (acao === 'FINALIZAR' && !todosItensValidadosSeparacao) {
      setError("Valide todos os itens por código de barras antes de finalizar a separação.");
      return;
    }
    // Se for FINALIZAR, pode exigir o BOX

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/separacao/acao`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          nunota: Number(separacaoNunota),
          acao,
          box: acao === 'FINALIZAR' ? separacaoBox : undefined
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (acao === 'INICIAR') {
          const produtos = Array.isArray(data?.produtosNunota) ? data.produtosNunota : [];
          setProdutosSeparacao(produtos);
          setNunotaProdutosCarregada(Number(separacaoNunota));
          const validacoesIniciais = produtos.reduce((acc: Record<string, boolean>, produto: ProdutoSeparacao) => {
            acc[getProdutoSeparacaoKey(produto)] = false;
            return acc;
          }, {});
          setItensValidadosSeparacao(validacoesIniciais);
          setItensRejeitadosSeparacao({});
          setItemSelecionadoSeparacao(null);
          setCodigoBarrasLido("");
          setFeedbackSeparacao("");
        }
        if (acao === 'FINALIZAR') {
          setSeparacaoNunota("");
          setSeparacaoBox("");
          setProdutosSeparacao([]);
          setNunotaProdutosCarregada(null);
          setItensValidadosSeparacao({});
          setItensRejeitadosSeparacao({});
          setItemSelecionadoSeparacao(null);
          setCodigoBarrasLido("");
          setFeedbackSeparacao("");
          setError("");
        }
        alert(`Ação '${acao}' registrada com sucesso para a Nota ${separacaoNunota}!`);
      } else {
        const errData = await res.json();
        setError(errData.message || `Erro ao registrar ação ${acao}`);
      }
    } catch {
      setError("Erro de rede ao comunicar com o servidor");
    } finally {
      setLoading(false);
    }
  };

  // --- LÓGICA SUPERVISOR ---
  const carregarDadosSupervisor = useCallback(async (tokenOverride?: string) => {
    const authToken = typeof tokenOverride === "string" ? tokenOverride : token;
    if (!authToken) return;

    try {
      const [statsRes, divRes, filaRes, logRes, repRes, opRes] = await Promise.all([
        fetch(`${API_URL}/contagem/supervisor/stats`, { headers: { "Authorization": `Bearer ${authToken}` } }),
        fetch(`${API_URL}/contagem/divergencias`, { headers: { "Authorization": `Bearer ${authToken}` } }),
        fetch(`${API_URL}/contagem/fila`, { headers: { "Authorization": `Bearer ${authToken}` } }),
        fetch(`${API_URL}/sankhya/last-sync`, { headers: { "Authorization": `Bearer ${authToken}` } }),
        fetch(`${API_URL}/contagem/reportados`, { headers: { "Authorization": `Bearer ${authToken}` } }),
        fetch(`${API_URL}/contagem/operadores`, { headers: { "Authorization": `Bearer ${authToken}` } }),
      ]);
      const sData = await statsRes.json();
      setSupStats({
        ...sData,
        rankingOperadores: garantirLista<OpStats>(sData?.rankingOperadores),
      });
      setDivergencias(garantirLista<Divergencia>(await divRes.json()));
      setFilaItems(garantirLista<ItemFila>(await filaRes.json()));
      setItensReportados(garantirLista<any>(await repRes.json()));
      setOperadoresContagem(garantirLista<Pick<User, "id" | "nome" | "login">>(await opRes.json()));

      const lastSyncLog = await logRes.json();
      if (lastSyncLog && lastSyncLog.dataExecucao) {
        setLastSync(new Date(lastSyncLog.dataExecucao).toLocaleString('pt-BR'));
      }
      setMetaGlobalEdit(sData.resumo.metaGlobalDiaria);
    } catch (e) { console.error(e); }
  }, [token]);

  const tratarDivergencia = async (id: number, acao: 'APROVAR' | 'RECONTAR' | 'FINALIZAR_ANALISE') => {
    setLoading(true);
    try {
      const operadorId = acao === "RECONTAR" && operadorRecontagem[id] ? Number(operadorRecontagem[id]) : null;
      const res = await fetch(`${API_URL}/contagem/divergencias/${id}/tratar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ acao, operadorId, observacao: `Tratado por ${user?.nome}` }),
      });
      if (res.ok) carregarDadosSupervisor();
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const reprocessarFinalizacao = async (id: number) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/contagem/divergencias/${id}/reprocessar-finalizacao`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Falha ao reprocessar finalização da ressalva.");
        return;
      }
      await carregarDadosSupervisor();
    } catch (e) {
      console.error(e);
      setError("Falha ao reprocessar finalização da ressalva.");
    } finally {
      setLoading(false);
    }
  };

  const buscarCopiaEstoque = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      Object.entries(copiaFiltro).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });

      const res = await fetch(`${API_URL}/contagem/direcionada/copia-sankhya?${params.toString()}`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Erro ao buscar cópia de estoque");
        return;
      }
      setCopiaItens(Array.isArray(data) ? data : []);
      setCopiaSelecionados({});
    } catch {
      setError("Erro ao buscar cópia de estoque");
    } finally {
      setLoading(false);
    }
  };

  const toggleCopiaSelecionada = (item: CopiaEstoqueItem) => {
    const key = getCopiaKey(item);
    setCopiaSelecionados((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleTodasCopias = () => {
    if (todosItensCopiaSelecionados) {
      setCopiaSelecionados({});
      return;
    }

    const proximos = copiaItens.reduce<Record<string, boolean>>((acc, item) => {
      acc[getCopiaKey(item)] = true;
      return acc;
    }, {});
    setCopiaSelecionados(proximos);
  };

  const direcionarItensSelecionados = async () => {
    if (!operadorDirecionado) {
      setError("Selecione o operador.");
      return;
    }
    if (copiaItensSelecionados.length === 0) {
      setError("Selecione ao menos um produto.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/contagem/direcionada/direcionar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          operadorId: Number(operadorDirecionado),
          prioridade: Number(prioridadeDirecionada) || 9000,
          motivo: motivoDirecionado,
          itens: copiaItensSelecionados,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Erro ao direcionar contagem");
        return;
      }

      const conflitos = Array.isArray(data.conflitos) ? data.conflitos.length : 0;
      alert(`${data.direcionados?.length || 0} item(ns) direcionado(s) para ${data.operador?.nome || "operador"}.${conflitos ? ` ${conflitos} conflito(s) ignorado(s).` : ""}`);
      setCopiaSelecionados({});
      await carregarDadosSupervisor();
    } catch {
      setError("Erro ao direcionar contagem");
    } finally {
      setLoading(false);
    }
  };

  const salvarMetaGlobal = async () => {
    try {
      await fetch(`${API_URL}/contagem/meta-global`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ valor: metaGlobalEdit }),
      });
      carregarDadosSupervisor();
    } catch (e) { console.error(e); }
  };

  // --- LÓGICA ENTREGAS / SPOKE ---
  const carregarEntregas = useCallback(async (tokenOverride?: string) => {
    const authToken = typeof tokenOverride === "string" ? tokenOverride : token;
    if (!authToken) return;

    try {
      const [entregasRes, motoristasRes] = await Promise.all([
        fetch(`${API_URL}/entregas`, { headers: { "Authorization": `Bearer ${authToken}` } }),
        fetch(`${API_URL}/entregas/motoristas`, { headers: { "Authorization": `Bearer ${authToken}` } }),
      ]);
      const entregasData = await entregasRes.json();
      const motoristasData = await motoristasRes.json();
      setEntregas(garantirLista<Entrega>(entregasData));
      setMotoristasSpoke(garantirLista<MotoristaSpoke>(motoristasData));
    } catch (e) {
      console.error(e);
      setError("Erro ao carregar entregas");
    }
  }, [token]);

  const entregasImportadas = useMemo<EntregaImportada[]>(() => {
    const texto = mensagensEntrega.trim();
    if (!texto) return [];

    const blocos = texto
      .split(/(?=N[ºo]\s*do pedido\s*:)/i)
      .map((bloco) => bloco.trim())
      .filter(Boolean);

    return blocos.map((bloco) => {
      const linhas = bloco
        .split(/\r?\n/)
        .map((linha) => linha.trim())
        .filter(Boolean);

      const getCampo = (regex: RegExp) => {
        const linha = linhas.find((item) => regex.test(item));
        return linha?.replace(regex, "").trim() || "";
      };

      const numeroPedido = getCampo(/^N[ºo]\s*do pedido\s*:\s*/i).replace(/\s*\(ID Externo\)\s*$/i, "");
      const clienteNome = getCampo(/^(Nome de cadastro|Nome Cliente)\s*:\s*/i);
      const telefone = getCampo(/^Telefone\s*:\s*/i);
      const pagamento = getCampo(/^Já efetuou o pagamento\?\s*/i);
      const googleMapsUrl = linhas.find((linha) => /^https?:\/\//i.test(linha)) || "";

      const enderecoLinhas = linhas.filter((linha) => {
        if (/^N[ºo]\s*do pedido\s*:/i.test(linha)) return false;
        if (/^(Nome de cadastro|Nome Cliente)\s*:/i.test(linha)) return false;
        if (/^Telefone\s*:/i.test(linha)) return false;
        if (/^Contato\s*:/i.test(linha)) return false;
        if (/^Já efetuou o pagamento\?/i.test(linha)) return false;
        if (/^Nome Vendedor\s*:/i.test(linha)) return false;
        if (/^entregar\b/i.test(linha)) return false;
        if (/^https?:\/\//i.test(linha)) return false;
        return true;
      });

      let uf = "GO";
      let cidade = "Goiânia";
      let bairro = "";
      let enderecoTexto = enderecoLinhas.join(", ");

      const cidadeLinha = enderecoLinhas[enderecoLinhas.length - 1] || "";
      const cidadeMatch = cidadeLinha.match(/^(.+?)\s*-\s*([A-Za-z]{2})$/);
      if (cidadeMatch) {
        cidade = cidadeMatch[1].trim();
        uf = cidadeMatch[2].toUpperCase();
      }

      const linhasSemCidade = cidadeMatch ? enderecoLinhas.slice(0, -1) : enderecoLinhas;
      bairro = linhasSemCidade.length > 1 ? linhasSemCidade[linhasSemCidade.length - 1] : "";
      enderecoTexto = (linhasSemCidade.length > 1 ? linhasSemCidade.slice(0, -1) : linhasSemCidade).join(", ");

      return {
        numeroPedido,
        clienteNome,
        telefone,
        enderecoTexto,
        bairro,
        cidade,
        uf,
        googleMapsUrl,
        pagamento,
        observacoes: bloco,
      };
    }).filter((entrega) => entrega.numeroPedido || entrega.clienteNome || entrega.enderecoTexto);
  }, [mensagensEntrega]);

  const entregasPendentesMotorista = useMemo(() => {
    if (!formEntrega.motoristaSpokeId) return [];
    return entregas.filter(
      (entrega) => entrega.motoristaSpokeId === formEntrega.motoristaSpokeId && !entrega.planSpokeId,
    );
  }, [entregas, formEntrega.motoristaSpokeId]);

  const criarRotaUnica = async (ids: number[]) => {
    if (ids.length === 0) {
      setError("Não há entregas pendentes para criar a rota única.");
      return false;
    }

    const res = await fetch(`${API_URL}/entregas/criar-rota-lote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ ids }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.message || "Erro ao criar rota única");
      return false;
    }

    return true;
  };

  const criarRotaUnicaPendentes = async () => {
    setLoading(true);
    try {
      const ok = await criarRotaUnica(entregasPendentesMotorista.map((entrega) => entrega.id));
      if (ok) {
        setError("");
        await carregarEntregas();
      }
    } catch {
      setError("Erro de rede ao criar rota única");
    } finally {
      setLoading(false);
    }
  };

  const criarEntregasEmLote = async (criarRotaDepois = true) => {
    if (entregasImportadas.length === 0) {
      setError("Cole ao menos uma mensagem de entrega.");
      return;
    }
    if (!formEntrega.motoristaSpokeId) {
      setError("Selecione o motorista para essas entregas.");
      return;
    }

    const incompletas = entregasImportadas.filter(
      (entrega) => !entrega.numeroPedido || !entrega.clienteNome || !entrega.enderecoTexto,
    );
    if (incompletas.length > 0) {
      setError("Algumas mensagens estão sem pedido, cliente ou endereço.");
      return;
    }

    const motorista = motoristasSpoke.find((m) => m.id === formEntrega.motoristaSpokeId);
    setLoading(true);
    try {
      const idsCriados: number[] = [];
      for (const entrega of entregasImportadas) {
        const res = await fetch(`${API_URL}/entregas`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({
            ...entrega,
            motoristaSpokeId: formEntrega.motoristaSpokeId,
            motoristaNome: motorista?.displayName || motorista?.name || "",
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          setError(data.message || `Erro ao salvar pedido ${entrega.numeroPedido}`);
          return;
        }
        const data = await res.json();
        if (data?.id) idsCriados.push(data.id);
      }

      if (criarRotaDepois) {
        const ok = await criarRotaUnica(idsCriados);
        if (!ok) return;
      }

      setMensagensEntrega("");
      setError("");
      await carregarEntregas();
    } catch {
      setError("Erro de rede ao salvar entregas em lote");
    } finally {
      setLoading(false);
    }
  };

  const criarEntrega = async (e: React.FormEvent) => {
    e.preventDefault();
    const motorista = motoristasSpoke.find((m) => m.id === formEntrega.motoristaSpokeId);
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/entregas`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          ...formEntrega,
          motoristaNome: motorista?.displayName || motorista?.name || "",
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.message || "Erro ao salvar entrega");
        return;
      }
      setFormEntrega({
        numeroPedido: "",
        clienteNome: "",
        telefone: "",
        enderecoTexto: "",
        bairro: "",
        cidade: "Goiânia",
        uf: "GO",
        googleMapsUrl: "",
        pagamento: "",
        observacoes: "",
        motoristaSpokeId: formEntrega.motoristaSpokeId,
      });
      setError("");
      await carregarEntregas();
    } catch {
      setError("Erro de rede ao salvar entrega");
    } finally {
      setLoading(false);
    }
  };

  const acaoEntrega = async (id: number, acao: "criar-rota" | "distribuir" | "finalizar") => {
    if (acao === "finalizar") {
      const confirmar = window.confirm("Finalizar esta rota e ocultar da lista?");
      if (!confirmar) return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/entregas/${id}/${acao}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.message || "Erro ao processar entrega");
        return;
      }
      setError("");
      await carregarEntregas();
    } catch {
      setError("Erro de rede ao processar entrega");
    } finally {
      setLoading(false);
    }
  };

  const excluirEntrega = async (entrega: Entrega) => {
    const confirmar = window.confirm(`Excluir o pedido ${entrega.numeroPedido} de ${entrega.clienteNome} da tela do Coletor?`);
    if (!confirmar) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/entregas/${entrega.id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.message || "Erro ao excluir entrega");
        return;
      }
      setError("");
      await carregarEntregas();
    } catch {
      setError("Erro de rede ao excluir entrega");
    } finally {
      setLoading(false);
    }
  };

  // --- LÓGICA USUÁRIOS (Admin) ---
  const carregarUsuarios = useCallback(async (tokenOverride?: string) => {
    const authToken = typeof tokenOverride === "string" ? tokenOverride : token;
    if (!authToken) return;

    try {
      const res = await fetch(`${API_URL}/auth/users`, {
        headers: { "Authorization": `Bearer ${authToken}` },
      });
      const data = await res.json();
      setUsuarios(garantirLista<any>(data));
    } catch (e) { console.error(e); }
  }, [token]);

  const handleSalvarUsuario = async () => {
    setLoading(true);
    try {
      const codusuLimpo = String(formUsuario.codusuSankhya || "").trim();
      if (codusuLimpo && !/^\d+$/.test(codusuLimpo)) {
        setError("Código Sankhya deve conter apenas números.");
        return;
      }

      const codusuSankhya = codusuLimpo ? Number(codusuLimpo) : null;
      const payload = usuarioEdit
        ? {
            nome: formUsuario.nome,
            role: formUsuario.role,
            codusuSankhya,
          }
        : {
            nome: formUsuario.nome,
            login: formUsuario.login,
            senha: formUsuario.senha,
            role: formUsuario.role,
            codusuSankhya,
          };

      const url = usuarioEdit ? `${API_URL}/auth/users/${usuarioEdit.id}` : `${API_URL}/auth/register`;
      const method = usuarioEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setShowModalUsuario(false);
        carregarUsuarios();
      } else {
        const data = await res.json();
        setError(data.message || "Erro ao salvar usuário");
      }
    } catch { setError("Erro de rede"); } finally { setLoading(false); }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleInativarUsuario = async (u: any) => {
    if (!u.id) return;
    if (!window.confirm(`Deseja ${u.ativo ? 'inativar' : 'ativar'} o usuário ${u.nome}?`)) return;
    try {
      await fetch(`${API_URL}/auth/users/${u.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ ativo: !u.ativo }),
      });
      carregarUsuarios();
    } catch (e) { console.error(e); }
  };

  const handleResetSenha = async (id: number) => {
    const nova = window.prompt("Digite a nova senha (mínimo 4 caracteres):");
    if (!nova || nova.length < 4) return;
    try {
      const res = await fetch(`${API_URL}/auth/users/${id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ novaSenha: nova }),
      });
      if (res.ok) alert("Senha resetada com sucesso!");
    } catch (e) { console.error(e); }
  };

  // --- LÓGICA RELATÓRIOS ---
  const exportarRelatorio = async (tipo: 'divergencias' | 'produtividade') => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/contagem/export/${tipo}`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      const data = await res.json();
      if (!Array.isArray(data)) return;

      // Converter para CSV (simplificado)
      const headers = Object.keys(data[0]);
      const csvContent = [
        headers.join(","),
        ...data.map(row => headers.map(h => `"${row[h]}"`).join(","))
      ].join("\n");

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `relatorio-${tipo}-${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch { setError("Erro ao exportar"); } finally { setLoading(false); }
  };

  useEffect(() => {
    if (token && user && user.role !== "OPERADOR") {
      carregarDadosSupervisor();
      if (moduloAtivo === "administracao") carregarUsuarios();
      if (moduloAtivo === "entregas") carregarEntregas();
    }
  }, [token, user, moduloAtivo, carregarDadosSupervisor, carregarUsuarios, carregarEntregas]);

  let content;

  if (!token) {
    content = (
      <div className={styles.loginViewport}>
        <div className={styles.loginShell}>
          <div className={styles.logoArea}>
            <div className={styles.logoIcon}>📦</div>
            <h1 className={styles.title}>Hub da Logística</h1>
            <p className={styles.subtitle}>Escolha o módulo e entre com seu usuário.</p>
          </div>

          <div className={styles.loginModuleGrid}>
            {MODULOS_LOGIN.map((modulo) => (
              <button
                key={modulo.id}
                type="button"
                className={`${styles.loginModuleCard} ${moduloLogin === modulo.id ? styles.loginModuleCardActive : ""}`}
                onClick={() => {
                  setModuloLogin(modulo.id);
                  setError("");
                }}
              >
                <span className={styles.moduleIcon}>{modulo.icon}</span>
                <strong>{modulo.titulo}</strong>
                <span>{modulo.descricao}</span>
                <small>{modulo.acesso}</small>
              </button>
            ))}
          </div>

          <div className={styles.loginContainer}>
            <div className={styles.loginPanelHeader}>
              <span>{MODULOS_LOGIN.find((modulo) => modulo.id === moduloLogin)?.icon}</span>
              <div>
                <strong>{MODULOS_LOGIN.find((modulo) => modulo.id === moduloLogin)?.titulo}</strong>
                <small>{MODULOS_LOGIN.find((modulo) => modulo.id === moduloLogin)?.acesso}</small>
              </div>
            </div>
            <form onSubmit={handleLogin} className={styles.form}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Login</label>
                <input type="text" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="Seu login" className={styles.input} required />
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Senha</label>
                <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Sua senha" className={styles.input} required />
              </div>
              {error && <div className={styles.errorMsg}>⚠️ {error}</div>}
              <button type="submit" className={styles.loginBtn} disabled={loading}>{loading ? "..." : "Entrar no módulo"}</button>
            </form>
          </div>
        </div>
      </div>
    );
  } else if (moduloAtivo === "operador" && (user?.role === "OPERADOR" || user?.role === "SUPERVISOR")) {
    content = (
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.welcomeInfo}>
            <span className={styles.roleIcon}>👷</span>
            <div>
              <h1 className={styles.welcomeTitle}>Olá, {user.nome.split(' ')[0]}</h1>
              <span className={styles.roleBadge} data-role={user.role}>{user.role}</span>
            </div>
          </div>
          <div className={styles.topTabs}>
             {user?.role !== "OPERADOR" && (
              <button onClick={() => setModuloAtivo("hub")} className={styles.tab}>Hub</button>
             )}
             {viewMode !== "MENU" && (
              <button onClick={() => setViewMode("MENU")} className={styles.tab}>Funções</button>
             )}
             <button onClick={() => setViewMode("CONTAGEM")} className={viewMode === "CONTAGEM" ? styles.tabActive : styles.tab}>Contagem</button>
             <button onClick={() => setViewMode("SEPARACAO")} className={viewMode === "SEPARACAO" ? styles.tabActive : styles.tab}>Separação</button>
          </div>
          {viewMode === "CONTAGEM" && statsOperador && (
            <div className={styles.topoMeta}>
              <span className={styles.metaLabel}>Meta: {statsOperador.total}/{statsOperador.metaDiaria}</span>
              <div className={styles.metaBar}><span style={{ width: `${statsOperador.progresso}%` }}></span></div>
              <span className={styles.metaValue}>{statsOperador.assertividade.toFixed(0)}%</span>
            </div>
          )}
          {viewMode === "CONTAGEM" && (
            <button
              type="button"
              onClick={abrirFilaDirecionadaOperador}
              className={styles.operatorQueueBtn}
              aria-label="Abrir contagens direcionadas"
              title="Contagens direcionadas"
            >
              <Icons.Queue className={styles.operatorQueueIcon} />
              {filaDirecionadaOperador.length > 0 && (
                <span className={styles.operatorQueueBadge}>{filaDirecionadaOperador.length}</span>
              )}
            </button>
          )}
          <button onClick={handleLogout} className={styles.smallLogout}>Sair</button>
        </div>

        {showFilaDirecionadaOperador && (
          <div className={styles.operatorQueueOverlay} role="dialog" aria-modal="true">
            <div className={styles.operatorQueuePanel}>
              <div className={styles.operatorQueueHeader}>
                <div>
                  <h2>Contagem direcionada</h2>
                  <p>{filaDirecionadaOperador.length} item(ns) para você</p>
                </div>
                <button
                  type="button"
                  className={styles.operatorQueueClose}
                  onClick={() => setShowFilaDirecionadaOperador(false)}
                  aria-label="Fechar fila direcionada"
                >
                  <Icons.XMark className={styles.buttonIcon} />
                </button>
              </div>

              {loadingFilaDirecionada ? (
                <div className={styles.operatorQueueEmpty}>Carregando...</div>
              ) : filaDirecionadaOperador.length === 0 ? (
                <div className={styles.operatorQueueEmpty}>Sem contagens direcionadas no momento.</div>
              ) : (
                <div className={styles.operatorQueueList}>
                  {filaDirecionadaOperador.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`${styles.operatorQueueItem} ${itemAtual?.id === item.id ? styles.operatorQueueItemActive : ""}`}
                      onClick={() => selecionarItemDirecionadoOperador(item.id)}
                      disabled={loadingFilaDirecionada}
                    >
                      <span className={styles.operatorQueueCode}>Cód: {item.codprod}</span>
                      <strong>{item.descprod}</strong>
                      <span className={styles.operatorQueueMeta}>
                        Prioridade {item.prioridadeManual || 0}
                        {item.motivoPriorizacao ? ` · ${item.motivoPriorizacao.replace("CONTAGEM_DIRECIONADA:", "").trim()}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {cameraCodigoBarrasAberta && (
          <div className={styles.cameraOverlay} role="dialog" aria-modal="true">
            <div className={styles.cameraPanel}>
              <div className={styles.cameraHeader}>
                <h2>Ler código</h2>
                <button
                  type="button"
                  className={styles.operatorQueueClose}
                  onClick={() => setCameraCodigoBarrasAberta(false)}
                  aria-label="Fechar câmera"
                >
                  <Icons.XMark className={styles.buttonIcon} />
                </button>
              </div>
              <video ref={cameraVideoRef} className={styles.cameraVideo} playsInline muted />
              {cameraCodigoBarrasErro && <p className={styles.cameraError}>{cameraCodigoBarrasErro}</p>}
            </div>
          </div>
        )}

        {error && <div className={styles.errorMsg} style={{ margin: '10px 0' }}>⚠️ {error}</div>}

        {viewMode === "MENU" && (
          <div className={styles.modeMenuCard}>
            <h2 className={styles.modeMenuTitle}>Escolha a Função</h2>
            <p className={styles.modeMenuSubtitle}>Selecione qual atividade você vai executar agora.</p>
            <div className={styles.modeMenuGrid}>
              <button type="button" className={styles.modeOptionCard} onClick={() => setViewMode("CONTAGEM")}>
                <span className={styles.modeOptionIcon}>📋</span>
                <span className={styles.modeOptionTitle}>Contagem</span>
                <span className={styles.modeOptionDesc}>Auditoria de estoque por item</span>
              </button>
              <button type="button" className={styles.modeOptionCard} onClick={() => setViewMode("SEPARACAO")}>
                <span className={styles.modeOptionIcon}>📦</span>
                <span className={styles.modeOptionTitle}>Separação</span>
                <span className={styles.modeOptionDesc}>Separação com validação por código de barras</span>
              </button>
            </div>
          </div>
        )}

        {viewMode === "CONTAGEM" && (
          <>
            {metaBatida && (
              <div className={styles.metaCelebration}>
                <span className={styles.celebrationEmoji}>🎉</span>
                <div>
                  <strong>Parabéns! Meta diária atingida!</strong>
                  <p>Continue contando para melhorar ainda mais o resultado.</p>
                </div>
                <button onClick={() => setMetaBatida(false)} className={styles.closeCelebration}>✕</button>
              </div>
            )}

            {!itemAtual ? (
              <div className={styles.startCard}>
                <button onClick={buscarProximo} className={styles.startBtn} disabled={loading}>
                  {loading ? "Buscando..." : "🚀 Iniciar Próxima Contagem"}
                </button>
              </div>
            ) : (
              <div className={styles.countingCard}>
                <div className={styles.productHeader}>
                  <div className={styles.productPhoto}>
                    <img src={getProdutoImagemUrl(itemAtual.codprod)}
                      onError={(e) => { (e.target as HTMLImageElement).src = `https://placehold.co/400x400/111827/0ea5e9?text=${itemAtual.codprod}` }}
                      alt={itemAtual.descprod} />
                  </div>
                  <div className={styles.productInfoArea}>
                    <span className={styles.productBadge}>CÓD: {itemAtual.codprod}</span>
                    <h2 className={styles.productTitle}>{itemAtual.descprod}</h2>
                    <div className={styles.productMetadata}>
                      {itemAtual.marca && <span className={styles.metaTag}>Marca: {itemAtual.marca}</span>}
                      {itemAtual.controle && itemAtual.controle !== ' ' && <span className={styles.metaTag}>Lote/Controle: {itemAtual.controle}</span>}
                      {itemAtual.unidade && <span className={styles.metaTag}>Und: {itemAtual.unidade}</span>}
                    </div>
                  </div>
                </div>
                <form onSubmit={registrarContagem} className={styles.countForm}>
                  <div className={styles.barcodePanel}>
                    <div className={styles.barcodePanelHeader}>
                      <label className={styles.quantityLabel} htmlFor="codigo-barras-contagem">
                        EAN do produto
                      </label>
                      {itemAtualSemCodigoBarras ? (
                        <span className={styles.barcodeStatusWarning}>Sem EAN cadastrado</span>
                      ) : codigoBarrasContagemValido ? (
                        <span className={styles.barcodeStatusOk}>Validado</span>
                      ) : (
                        <span className={styles.barcodeStatusPending}>Pendente</span>
                      )}
                    </div>
                    <div className={styles.barcodeInputRow}>
                      <input
                        id="codigo-barras-contagem"
                        ref={codigoBarrasContagemInputRef}
                        type="text"
                        inputMode="numeric"
                        value={codigoBarrasContagem}
                        onFocus={() => setMostrarTecladoQuantidade(false)}
                        onChange={(e) => {
                          setCodigoBarrasContagem(e.target.value.replace(/\D/g, ""));
                          setError("");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const codigoDigitado = normalizarApenasDigitos(e.currentTarget.value);
                            if (codigosBarrasItemAtual.includes(codigoDigitado)) {
                              setCodigoBarrasContagem(codigoDigitado);
                              setError("");
                              quantidadeInputRef.current?.focus();
                              setMostrarTecladoQuantidade(false);
                            } else {
                              setError("EAN não confere com o produto selecionado.");
                            }
                          }
                        }}
                        className={`${styles.input} ${styles.barcodeInput}`}
                        placeholder="Bipe ou digite o EAN"
                        autoComplete="off"
                        disabled={itemAtualSemCodigoBarras}
                      />
                      <button
                        type="button"
                        className={styles.cameraButton}
                        onClick={() => {
                          setCameraCodigoBarrasErro("");
                          setCameraCodigoBarrasAberta(true);
                        }}
                        disabled={itemAtualSemCodigoBarras}
                      >
                        Câmera
                      </button>
                    </div>
                    {!itemAtualSemCodigoBarras && (
                      <p className={styles.barcodeHint}>
                        EAN cadastrado: {codigosBarrasItemAtual[0]}
                      </p>
                    )}
                  </div>
                  <div className={styles.quantityPanel}>
                    <label className={styles.quantityLabel} htmlFor="quantidade-contada">
                      Quantidade contada
                    </label>
                    {!quantidadeContagemHabilitada && (
                      <p className={styles.quantityGateMessage}>
                        Valide o EAN cadastrado para liberar a quantidade.
                      </p>
                    )}
                    <div className={styles.quantityEntry}>
                      <input
                        id="quantidade-contada"
                        ref={quantidadeInputRef}
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9.,]*"
                        value={qtd}
                        onChange={(e) => setQtd(formatarQuantidadeDigitada(e.target.value))}
                        onFocus={() => {
                          if (quantidadeContagemHabilitada) setMostrarTecladoQuantidade(true);
                        }}
                        onClick={() => {
                          if (quantidadeContagemHabilitada) setMostrarTecladoQuantidade(true);
                        }}
                        className={styles.countInput}
                        placeholder="0,000"
                        autoComplete="off"
                        disabled={!quantidadeContagemHabilitada}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            registrarContagem(e as any);
                          }
                        }}
                      />
                      {itemAtual.unidade && <span className={styles.quantityUnit}>{itemAtual.unidade}</span>}
                    </div>
                    {mostrarTecladoQuantidade && quantidadeContagemHabilitada && (
                      <div className={styles.touchKeypad}>
                        {TECLAS_QUANTIDADE.map((tecla) => {
                          const label =
                            tecla === "backspace"
                              ? "←"
                              : tecla === "clear"
                                ? "C"
                                : tecla === "decimal"
                                  ? ","
                                  : tecla;
                          const isAction = tecla === "backspace" || tecla === "clear";
                          return (
                            <button
                              key={tecla}
                              type="button"
                              className={`${styles.keypadButton} ${isAction ? styles.keypadAction : ""}`}
                              onClick={() => aplicarTeclaQuantidade(tecla)}
                              disabled={loading || !quantidadeContagemHabilitada}
                              aria-label={tecla === "backspace" ? "Apagar" : tecla === "clear" ? "Limpar" : label}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <button type="submit" className={styles.confirmBtn} disabled={loading || !quantidadeContagemHabilitada}>
                    <Icons.Check className={styles.buttonIcon} />
                    Confirmar Quantidade
                  </button>
                </form>
                <div className={styles.actionButtonsSecondary}>
                  <button type="button" onClick={handleNaoAchei} className={styles.naoAcheiBtnRed} disabled={loading}>Não Achei</button>
                  <button type="button" onClick={handleReportarProblema} className={styles.reportBtn} disabled={loading}>⚠️ Reportar Erro</button>
                </div>
              </div>
            )}
          </>
        )}

        {viewMode === "SEPARACAO" && (
          <div className={styles.separacaoCard}>
            <h2 className={styles.separacaoTitle}>📦 Controle de Separação</h2>

            <div className={styles.inputGroup}>
              <label className={styles.label}>Nro. Único da Nota (NUNOTA)</label>
              <input
                type="text"
                inputMode="none"
                value={separacaoNunota}
                onChange={(e) => setSeparacaoNunota(e.target.value.replace(/\D/g, ""))}
                className={styles.input}
                placeholder="Insira o NUNOTA"
                autoComplete="off"
              />
            </div>

            <div className={styles.separacaoGrid}>
               <button onClick={() => handleSeparacaoAcao('INICIAR')} disabled={loading} className={`${styles.sepBtn} ${styles.btnIniciar}`}>
                 ▶ Iniciar
               </button>
               <button onClick={() => handleSeparacaoAcao('PAUSAR')} disabled={loading} className={`${styles.sepBtn} ${styles.btnPausar}`}>
                 ⏸ Pausar
               </button>
               <button onClick={() => handleSeparacaoAcao('RETORNAR')} disabled={loading} className={`${styles.sepBtn} ${styles.btnRetornar}`}>
                 🔄 Retomar
               </button>
            </div>

            <div className={styles.finalizarGroup}>
              <label className={styles.label}>Box (Apenas para Finalizar)</label>
              <input
                type="text"
                value={separacaoBox}
                onChange={(e) => setSeparacaoBox(e.target.value)}
                className={styles.input}
                placeholder="Ex: Box 1"
              />
              <button onClick={() => handleSeparacaoAcao('FINALIZAR')} disabled={loading || !todosItensValidadosSeparacao} className={`${styles.sepBtn} ${styles.btnFinalizar}`}>
                ✅ Finalizar
              </button>
              {produtosSeparacao.length > 0 && !todosItensValidadosSeparacao && (
                <p className={styles.finalizarHint}>
                  Valide todos os itens por código de barras para liberar a finalização ({totalItensValidadosSeparacao}/{totalItensSeparacao}).
                </p>
              )}
            </div>

            {nunotaProdutosCarregada === Number(separacaoNunota) && (
              <div className={styles.produtosNunotaSection}>
                <h3 className={styles.produtosNunotaTitle}>
                  Produtos da Nota {nunotaProdutosCarregada}
                </h3>
                {produtosSeparacao.length > 0 && (
                  <p className={styles.validacaoProgresso}>
                    Itens validados: {totalItensValidadosSeparacao}/{totalItensSeparacao}
                  </p>
                )}

                {produtosSeparacao.length === 0 ? (
                  <p className={styles.produtosNunotaEmpty}>Nenhum produto encontrado para esta NUNOTA.</p>
                ) : (
                  <>
                    <div className={styles.scannerArea}>
                      <label className={styles.label}>Código de barras do item selecionado</label>
                      <div className={styles.scannerRow}>
                        <input
                          id="scanner-codigo-barras"
                          ref={scannerInputRef}
                          type="text"
                          inputMode="none"
                          readOnly
                          value={codigoBarrasLido}
                          onFocus={(event) => event.target.blur()}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            (event.currentTarget as HTMLInputElement).blur();
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              validarCodigoBarrasItemSelecionado();
                            }
                          }}
                          className={styles.input}
                          placeholder={itemSelecionadoSeparacao ? "Leia/escaneie o código" : "Selecione um item abaixo"}
                          disabled={!itemSelecionadoSeparacao}
                        />
                        <button
                          type="button"
                          className={`${styles.sepBtn} ${styles.btnIniciar} ${styles.btnValidarCodigo}`}
                          onClick={() => validarCodigoBarrasItemSelecionado()}
                          disabled={!itemSelecionadoSeparacao}
                        >
                          Validar Item
                        </button>
                      </div>
                      {feedbackSeparacao && <p className={styles.feedbackSeparacao}>{feedbackSeparacao}</p>}
                    </div>

                    <div className={styles.produtosNunotaList}>
                      {produtosSeparacao.map((produto) => {
                        const produtoKey = getProdutoSeparacaoKey(produto);
                        const validado = !!itensValidadosSeparacao[produtoKey];
                        const rejeitado = !!itensRejeitadosSeparacao[produtoKey];
                        const pendente = !validado && !rejeitado;
                        const selecionado = itemSelecionadoSeparacao === produtoKey;
                        const codigoCadastro = String(produto.codigoBarrasCadastro || "").trim();
                        const qtdDigitosCodigoCadastro = normalizarApenasDigitos(codigoCadastro).length;
                        const exibirCodigoCadastro = qtdDigitosCodigoCadastro > 0 && qtdDigitosCodigoCadastro <= 10;

                        return (
                          <button
                            key={produtoKey}
                            type="button"
                            onClick={() => {
                              setItemSelecionadoSeparacao(produtoKey);
                              setFeedbackSeparacao("");
                              setTimeout(() => scannerInputRef.current?.focus(), 10);
                            }}
                            className={`${styles.produtoNunotaItem} ${selecionado ? styles.produtoNunotaItemSelecionado : ''} ${validado ? styles.produtoNunotaItemValidado : ''} ${rejeitado ? styles.produtoNunotaItemRejeitado : ''}`}
                          >
                            <div className={styles.produtoNunotaTop}>
                              <div className={styles.produtoNunotaThumb}>
                                <img
                                  src={getProdutoImagemUrl(produto.codprod)}
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = `https://placehold.co/100x100/e2e8f0/475569?text=${produto.codprod}`;
                                  }}
                                  alt={produto.descprod}
                                  loading="lazy"
                                />
                              </div>
                              <div className={styles.produtoNunotaMain}>
                                <span className={styles.produtoNunotaCod}>#{produto.codprod}</span>
                                <span className={styles.produtoNunotaDesc}>{produto.descprod}</span>
                                {pendente && <span className={`${styles.produtoStatusBadge} ${styles.produtoStatusPendente}`}>Pendente</span>}
                                {validado && <span className={`${styles.produtoStatusBadge} ${styles.produtoStatusValidado}`}>Validado</span>}
                                {rejeitado && <span className={`${styles.produtoStatusBadge} ${styles.produtoStatusRejeitado}`}>Rejeitado</span>}
                              </div>
                            </div>
                            <div className={styles.produtoNunotaMeta}>
                              <span>Seq: {produto.sequencia}</span>
                              <span>Qtd: {Number(produto.qtdneg || 0).toLocaleString('pt-BR')}</span>
                              <span>Und: {produto.codvol || '-'}</span>
                              <span>Controle: {produto.controle?.trim() || '-'}</span>
                              <span>Localização: {produto.localizacao?.trim() || '-'}</span>
                              {exibirCodigoCadastro && (
                                <span>Cód. Barras: {codigoCadastro}</span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  } else if (user?.role === "SUPERVISOR" || user?.role === "ADMIN") {
    content = (
      <div className={`${styles.supContainer} ${moduloAtivo !== "hub" ? styles.moduleContentCentered : ""}`}>
        <div className={styles.supHeader}>
          <div className={styles.welcomeInfo}>
            <div className="p-2 bg-primary/10 rounded-lg text-primary icon-lg">
              <Icons.Home className="w-6 h-6" />
            </div>
            <div>
              <h1 className={styles.welcomeTitle}>Hub da Logística</h1>
              <p className={styles.supSubtitle}>
                {moduloAtivo === "hub" && "Escolha um módulo para operar"}
                {moduloAtivo === "contagem" && "Módulo Contagem"}
                {moduloAtivo === "entregas" && "Módulo Entregas"}
                {moduloAtivo === "administracao" && "Módulo Administração"}
              </p>
            </div>
          </div>
          <div className={styles.supNav}>
            <div className={styles.navTabs}>
              {moduloAtivo !== "hub" && (
                <button onClick={() => setModuloAtivo("hub")} className={styles.tab}>
                  <Icons.Home className="w-4 h-4 inline mr-2" /> Hub
                </button>
              )}
              {moduloAtivo === "contagem" && (
                <>
                  <button onClick={() => setAbaAtiva("dashboard")} className={abaAtiva === "dashboard" ? styles.tabActive : styles.tab}>
                    <Icons.Home className="w-4 h-4 inline mr-2" /> Dashboard
                  </button>
                  <button onClick={() => setAbaAtiva("fila")} className={abaAtiva === "fila" ? styles.tabActive : styles.tab}>
                    <Icons.Queue className="w-4 h-4 inline mr-2" /> Fila
                  </button>
                  <button onClick={() => setAbaAtiva("direcionada")} className={abaAtiva === "direcionada" ? styles.tabActive : styles.tab}>
                    <Icons.Users className="w-4 h-4 inline mr-2" /> Direcionada
                  </button>
                  <button onClick={() => setAbaAtiva("relatorios")} className={abaAtiva === "relatorios" ? styles.tabActive : styles.tab}>
                    <Icons.Reports className="w-4 h-4 inline mr-2" /> Relatórios
                  </button>
                  <button onClick={() => setAbaAtiva("config")} className={abaAtiva === "config" ? styles.tabActive : styles.tab}>
                    <Icons.Config className="w-5 h-5" />
                  </button>
                </>
              )}
              {moduloAtivo === "entregas" && (
                <button className={styles.tabActive}>
                  <Icons.Queue className="w-4 h-4 inline mr-2" /> Entregas
                </button>
              )}
              {moduloAtivo === "administracao" && (
                <button className={styles.tabActive}>
                  <Icons.Users className="w-4 h-4 inline mr-2" /> Usuários
                </button>
              )}
            </div>
            {moduloAtivo === "contagem" && (
              <button onClick={() => carregarDadosSupervisor()} className={styles.syncBtn}>
                <Icons.Sync className="w-4 h-4 inline mr-2" /> Sincronizar
              </button>
            )}
            <div className={styles.userProfile}>
              <span className={styles.userNameHeader}>{user.nome}</span>
              <button onClick={handleLogout} className={styles.smallLogout}>
                <Icons.Logout className="w-4 h-4 text-slate-400 hover:text-white" />
              </button>
            </div>
          </div>
        </div>

        {moduloAtivo === "hub" ? (
          <div className={styles.moduleHub}>
            <div className={styles.moduleHero}>
              <h2>Hub da Logística</h2>
              <p>Centralize as rotinas de contagem, entregas, administração e operação em módulos separados.</p>
            </div>
            <div className={styles.moduleGrid}>
              <button
                type="button"
                className={styles.moduleCard}
                onClick={() => { setModuloAtivo("contagem"); setAbaAtiva("dashboard"); }}
              >
                <span className={styles.moduleIcon}>📊</span>
                <strong>Módulo Contagem</strong>
                <span>Dashboard, fila e relatórios de auditoria.</span>
              </button>
              <button
                type="button"
                className={styles.moduleCard}
                onClick={() => { setModuloAtivo("entregas"); setAbaAtiva("entregas"); carregarEntregas(); }}
              >
                <span className={styles.moduleIcon}>🚚</span>
                <strong>Módulo Entregas</strong>
                <span>Mensagens, rotas e distribuição na Spoke.</span>
              </button>
              <button
                type="button"
                className={styles.moduleCard}
                onClick={() => { setModuloAtivo("administracao"); setAbaAtiva("usuarios"); carregarUsuarios(); }}
              >
                <span className={styles.moduleIcon}>👥</span>
                <strong>Módulo Administração</strong>
                <span>Usuários, cargos, acessos e códigos Sankhya.</span>
              </button>
              <button
                type="button"
                className={styles.moduleCard}
                onClick={() => { setModuloAtivo("operador"); setViewMode("MENU"); }}
              >
                <span className={styles.moduleIcon}>🧾</span>
                <strong>Módulo Operador</strong>
                <span>Funções Contagem e Separação.</span>
              </button>
            </div>
          </div>
        ) : abaAtiva === "dashboard" ? (
          <>
            {supStats && (
              <div className={styles.globalProgressCard}>
                <div className={styles.globalProgressHeader}>
                  <h2 className={styles.globalProgressTitle}>Progresso Global</h2>
                  <span className={styles.globalProgressLabel}>{supStats.resumo.totalContado} / {supStats.resumo.metaGlobalDiaria}</span>
                </div>
                <div className={styles.globalProgressBar}><span style={{ width: `${Math.min(supStats.resumo.progressoGlobal, 100)}%` }}></span></div>
              </div>
            )}

            {supStats && (
              <div className={styles.kpiGrid}>
                <div className={styles.kpiCard} data-type="alert">
                  <span className={styles.kpiLabel}>Divergências</span>
                  <span className={styles.kpiValue}>{supStats.resumo.divergenciasPendentes}</span>
                </div>
                <div className={styles.kpiCard} data-type="error">
                  <span className={styles.kpiLabel}>Valor Falta</span>
                  <span className={styles.kpiValue}>R$ {supStats.resumo.valorEmFalta.toLocaleString()}</span>
                </div>
                <div className={styles.kpiCard} data-type="success">
                  <span className={styles.kpiLabel}>Valor Sobra</span>
                  <span className={styles.kpiValue}>R$ {supStats.resumo.valorEmSobra.toLocaleString()}</span>
                </div>
                <div className={styles.kpiCard}>
                  <span className={styles.kpiLabel}>Assertividade</span>
                  <span className={styles.kpiValue}>{supStats.resumo.assertividadeGlobal.toFixed(1)}%</span>
                </div>
              </div>
            )}

            <div className={styles.supContent}>
              <div className={styles.divPanel}>
                <h2 className={styles.panelTitle}>Divergências Pendentes</h2>
                <div className={styles.divTable}>
                  <div className={styles.tableHeader}>
                    <span>Produto / Operador</span>
                    <span>Esperado</span>
                    <span>Contado</span>
                    <span>Dif / %</span>
                    <span>Ações</span>
                  </div>
                  {divergencias.length === 0 ? (
                    <div className={styles.emptyTable}>Tudo limpo! ✅</div>
                  ) : divergencias.map(d => {
                    const finalizacaoErro = d.adjustStatus === "FINALIZACAO_ERROR";
                    const erroFinalizacao = d.movimentacoes?.fluxoInventario?.sankhyaFinalizacaoRessalva?.error;
                    return (
                      <div key={d.id} className={styles.tableRow}>
                        <div className={styles.prodCol}>
                          <span className={styles.prodName}>{d.contagem.snapshot?.descprod || `Cód: ${d.contagem.codprod}`}</span>
                          <span className={styles.userName}>{d.contagem.user.nome}</span>
                          {d.movimentacoes?.fluxoInventario?.segregacaoRessalva && (
                            <span className={styles.auditMeta}>
                              AUDITORIA · {d.movimentacoes.fluxoInventario.segregacaoRessalva.tipo} · Qtd {Number(d.movimentacoes.fluxoInventario.segregacaoRessalva.quantidade).toFixed(2)}
                            </span>
                          )}
                          {finalizacaoErro && (
                            <span className={styles.auditErrorMeta} title={erroFinalizacao || "Falha ao finalizar ressalva no Sankhya"}>
                              FINALIZAÇÃO SANKHYA PENDENTE
                            </span>
                          )}
                        </div>
                        <span className={styles.numCol}>{Number(d.contagem.esperadoNoMomento).toFixed(2)}</span>
                        <span className={styles.numCol}>{Number(d.contagem.qtdContada).toFixed(2)}</span>
                        <div className={styles.diffCol}>
                          <span className={d.contagem.divergencia < 0 ? styles.textError : styles.textSuccess}>
                            {d.contagem.divergencia > 0 ? '+' : ''}{Number(d.contagem.divergencia).toFixed(2)}
                          </span>
                          <span className={styles.percVal}>{Number(d.contagem.divergenciaPercent).toFixed(1)}%</span>
                        </div>
                        {/* ... divergence map ... */}
                        <div className={styles.actions}>
                          {finalizacaoErro ? (
                            <button
                              onClick={() => reprocessarFinalizacao(d.id)}
                              className={styles.btnRetryFinalize}
                              title="Reprocessar finalização da ressalva"
                              disabled={loading}
                            >
                              <Icons.Sync className="w-5 h-5" />
                            </button>
                          ) : (
                            <>
                              <select
                                className={styles.recountSelect}
                                value={operadorRecontagem[d.id] || ""}
                                onChange={(e) => setOperadorRecontagem((prev) => ({ ...prev, [d.id]: e.target.value }))}
                                title="Operador para segunda contagem"
                              >
                                <option value="">Aleatório</option>
                                {operadoresContagem.map((op) => (
                                  <option key={op.id} value={op.id}>{op.nome}</option>
                                ))}
                              </select>
                              <button onClick={() => tratarDivergencia(d.id, "RECONTAR")} className={styles.btnRecount} title="Solicitar Recontagem">
                                <Icons.Sync className="w-5 h-5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className={styles.rankingPanel}>
                <h3 className={styles.panelTitle}>Ranking Operadores</h3>
                <div className={styles.rankingList}>
                  {supStats?.rankingOperadores.map((op, idx) => (
                    <div key={idx} className={styles.rankingItem}>
                      <span className={styles.rankName}>{op.nome}</span>
                      <div className={styles.rankBarArea}>
                        <div className={styles.rankBar}><span style={{ width: `${op.assertividade}%` }}></span></div>
                        <span className={styles.rankVal}>{op.assertividade.toFixed(0)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : abaAtiva === "fila" ? (
          <div className={styles.divPanel}>
            <h3 className={styles.panelTitle}>Fila de Contagem ({filaItems.length})</h3>
            <div className={styles.divTable}>
              <div className={styles.filaHeader}>
                <span>Produto</span>
                <span>Local</span>
                <span>Status</span>
              </div>
              {filaItems.map(f => (
                <div key={f.id} className={styles.filaRow}>
                  <div className={styles.prodCol}>
                    <span className={styles.prodName}>{f.descprod}</span>
                    <span className={styles.userName}>Cód: {f.codprod}</span>
                    {f.priorizadoPor && (
                      <span className={styles.directedBadge}>
                        Direcionada para {f.priorizador?.nome || `operador ${f.priorizadoPor}`}
                      </span>
                    )}
                    {f.motivoPriorizacao && (
                      <span className={styles.queueReason}>{f.motivoPriorizacao}</span>
                    )}
                  </div>
                  <span className={styles.tagCol}>{f.codlocal}</span>
                  <span className={styles.statusBadge} data-status={f.status}>{f.status}</span>
                </div>
              ))}
            </div>
          </div>
        ) : abaAtiva === "direcionada" ? (
          <div className={styles.divPanel}>
            <div className={styles.panelHeader}>
              <h3 className={styles.panelTitle}>Contagem Direcionada</h3>
              <button className={styles.confirmBtnSmall} disabled={loading} onClick={buscarCopiaEstoque}>
                {loading ? "Buscando..." : "Buscar cópia"}
              </button>
            </div>

            <div className={styles.directedFilters}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Data da cópia</label>
                <input
                  type="date"
                  className={styles.input}
                  value={copiaFiltro.data}
                  onChange={(e) => setCopiaFiltro({ ...copiaFiltro, data: e.target.value })}
                />
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Empresa</label>
                <input
                  className={styles.input}
                  value={copiaFiltro.codemp}
                  onChange={(e) => setCopiaFiltro({ ...copiaFiltro, codemp: e.target.value })}
                />
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Local</label>
                <input
                  className={styles.input}
                  value={copiaFiltro.codlocal}
                  onChange={(e) => setCopiaFiltro({ ...copiaFiltro, codlocal: e.target.value })}
                />
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Sequência</label>
                <input
                  className={styles.input}
                  value={copiaFiltro.sequencia}
                  onChange={(e) => setCopiaFiltro({ ...copiaFiltro, sequencia: e.target.value })}
                />
              </div>
              <div className={`${styles.inputGroup} ${styles.filterWide}`}>
                <label className={styles.label}>Busca</label>
                <input
                  className={styles.input}
                  value={copiaFiltro.busca}
                  onChange={(e) => setCopiaFiltro({ ...copiaFiltro, busca: e.target.value })}
                  placeholder="Produto ou código"
                />
              </div>
            </div>

            <div className={styles.directedActionBar}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Operador</label>
                <select className={styles.input} value={operadorDirecionado} onChange={(e) => setOperadorDirecionado(e.target.value)}>
                  <option value="">Selecione</option>
                  {operadoresContagem.map((op) => (
                    <option key={op.id} value={op.id}>{op.nome}</option>
                  ))}
                </select>
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Prioridade</label>
                <input
                  type="number"
                  className={styles.input}
                  value={prioridadeDirecionada}
                  onChange={(e) => setPrioridadeDirecionada(e.target.value)}
                />
              </div>
              <div className={`${styles.inputGroup} ${styles.filterWide}`}>
                <label className={styles.label}>Motivo</label>
                <input
                  className={styles.input}
                  value={motivoDirecionado}
                  onChange={(e) => setMotivoDirecionado(e.target.value)}
                  placeholder="Compra iluminação, urgência, inventário parcial..."
                />
              </div>
              <button className={styles.syncBtn} onClick={toggleTodasCopias} disabled={copiaItens.length === 0}>
                {todosItensCopiaSelecionados ? "Limpar seleção" : "Selecionar todos"}
              </button>
              <button className={styles.confirmBtnSmall} onClick={direcionarItensSelecionados} disabled={loading || copiaItensSelecionados.length === 0}>
                Direcionar ({copiaItensSelecionados.length})
              </button>
            </div>

            <div className={styles.directedSummary}>
              <span>{copiaItens.length} item(ns) na cópia</span>
              <span>{copiaItensSelecionados.length} selecionado(s)</span>
            </div>

            <div className={styles.divTable}>
              <div className={styles.directedHeader}>
                <span></span>
                <span>Produto</span>
                <span>Controle</span>
                <span>Local</span>
                <span>Qtd cópia</span>
                <span>Status</span>
              </div>
              {copiaItens.length === 0 ? (
                <div className={styles.emptyTable}>Nenhuma cópia carregada.</div>
              ) : copiaItens.map((item) => {
                const key = getCopiaKey(item);
                return (
                  <div key={key} className={styles.directedRow}>
                    <label className={styles.checkCell}>
                      <input
                        type="checkbox"
                        checked={!!copiaSelecionados[key]}
                        onChange={() => toggleCopiaSelecionada(item)}
                      />
                    </label>
                    <div className={styles.prodCol}>
                      <span className={styles.prodName}>{item.descprod}</span>
                      <span className={styles.userName}>Cód: {item.codprod}</span>
                    </div>
                    <span className={styles.tagCol}>{item.controle || "-"}</span>
                    <span className={styles.tagCol}>{item.codlocal}</span>
                    <span className={styles.numCol}>{Number(item.qtdCopiada || 0).toFixed(2)} {item.codvol || ""}</span>
                    <span className={styles.statusBadge} data-status={item.statusFila || "PENDENTE"}>
                      {item.statusFila || "NOVO"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : abaAtiva === "usuarios" ? (
          <div className={styles.divPanel}>
            <div className={styles.panelHeader}>
              <h3 className={styles.panelTitle}>Gestão de Usuários</h3>
              <button className={styles.confirmBtnSmall} onClick={() => { setUsuarioEdit(null); setFormUsuario({ nome: "", login: "", senha: "", role: "OPERADOR", codusuSankhya: "" }); setShowModalUsuario(true); }}>+ Novo</button>
            </div>
            <div className={styles.divTable}>
              <div className={styles.tableHeader}>
                <span>Nome</span>
                <span>Login</span>
                <span>Cargo</span>
                <span>Cód Sankhya</span>
                <span>Status</span>
                <span>Ações</span>
              </div>
              {usuarios.map(u => (
                <div key={u.id} className={styles.tableRow}>
                  {/*
                    Supervisor não pode alterar usuário ADMIN.
                    O backend já bloqueia; aqui só melhora a UX.
                  */}
                  {(() => {
                    const supervisorBloqueado = user?.role === "SUPERVISOR" && u.role === "ADMIN";
                    return (
                      <>
                  <span className={styles.prodName}>{u.nome}</span>
                  <span>{u.login}</span>
                  <span className={styles.roleBadge} data-role={u.role}>{u.role}</span>
                  <span>{u.codusuSankhya ?? "-"}</span>
                  <span style={{ color: u.ativo ? '#10b981' : '#ef4444' }}>{u.ativo ? 'Ativo' : 'Inativo'}</span>
                  <div className={styles.userActions}>
                    <button
                      onClick={() => handleResetSenha(u.id)}
                      title={supervisorBloqueado ? "Apenas ADMIN pode alterar usuário ADMIN" : "Reset Senha"}
                      className={`${styles.userActionBtn} ${styles.userActionBtnNeutral}`}
                      disabled={supervisorBloqueado}
                    >
                      <Icons.Key className={styles.userActionIcon} />
                      <span>Reset Senha</span>
                    </button>
                    <button
                      onClick={() => { setUsuarioEdit(u); setFormUsuario({ nome: u.nome, login: u.login, senha: "", role: u.role, codusuSankhya: u.codusuSankhya ? String(u.codusuSankhya) : "" }); setShowModalUsuario(true); }}
                      title={supervisorBloqueado ? "Apenas ADMIN pode alterar usuário ADMIN" : "Editar"}
                      className={`${styles.userActionBtn} ${styles.userActionBtnEdit}`}
                      disabled={supervisorBloqueado}
                    >
                      <Icons.Edit className={styles.userActionIcon} />
                      <span>Editar</span>
                    </button>
                    <button
                      onClick={() => handleInativarUsuario(u)}
                      title={supervisorBloqueado ? "Apenas ADMIN pode alterar usuário ADMIN" : (u.ativo ? 'Inativar' : 'Ativar')}
                      className={`${styles.userActionBtn} ${u.ativo ? styles.userActionBtnDanger : styles.userActionBtnSuccess}`}
                      disabled={supervisorBloqueado}
                    >
                      {u.ativo ? <Icons.Ban className={styles.userActionIcon} /> : <Icons.Check className={styles.userActionIcon} />}
                      <span>{u.ativo ? 'Inativar' : 'Ativar'}</span>
                    </button>
                  </div>
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>
          </div>
        ) : abaAtiva === "entregas" ? (
          <div className={styles.entregasGrid}>
            <div className={styles.entregasEditorStack}>
              <div className={styles.entregaForm}>
                <div className={styles.panelHeader}>
                  <h3 className={styles.panelTitle}>Mensagens de Entrega</h3>
                  <button type="button" className={styles.confirmBtnSmall} disabled={loading || entregasImportadas.length === 0} onClick={() => criarEntregasEmLote(true)}>
                    {loading ? "..." : `Salvar e criar rota única`}
                  </button>
                </div>

                <div className={styles.inputGroup}>
                  <label className={styles.label}>Motorista</label>
                  <select className={styles.input} value={formEntrega.motoristaSpokeId} onChange={(e) => setFormEntrega({ ...formEntrega, motoristaSpokeId: e.target.value })}>
                    <option value="">Selecione</option>
                    {motoristasSpoke.filter((m) => m.active).map((m) => (
                      <option key={m.id} value={m.id}>{m.displayName || m.name || m.id}</option>
                    ))}
                  </select>
                </div>

                <textarea
                  className={styles.entregaPasteBox}
                  value={mensagensEntrega}
                  onChange={(e) => setMensagensEntrega(e.target.value)}
                  placeholder={"Cole aqui várias mensagens do WhatsApp...\n\nNº do pedido: 123456 (ID Externo)\nNome Cliente: Nome Cliente (Nome Cliente / Parceiro/Destinatário)\nTelefone: 6299999-9999\nRua Cv3, Qd. 01 Lt. 02\nCenter Ville\nGoiânia - GO\nJá efetuou o pagamento? Pago no PIX / Receber na Hora\nNome Vendedor: Bruno Borges"}
                />

                <div className={styles.entregaPreviewHeader}>
                  <span>{entregasImportadas.length} entrega(s) detectada(s)</span>
                  {mensagensEntrega && (
                    <div className={styles.entregaInlineActions}>
                      <button type="button" className={styles.linkButton} disabled={loading} onClick={() => criarEntregasEmLote(false)}>Só salvar</button>
                      <button type="button" className={styles.linkButton} onClick={() => setMensagensEntrega("")}>Limpar</button>
                    </div>
                  )}
                </div>

                {entregasImportadas.length > 0 && (
                  <div className={styles.entregaPreviewList}>
                    {entregasImportadas.map((entrega, index) => (
                      <div key={`${entrega.numeroPedido}-${index}`} className={styles.entregaPreviewItem}>
                        <strong>{entrega.numeroPedido || "Sem pedido"} · {entrega.clienteNome || "Sem cliente"}</strong>
                        <span>{[entrega.enderecoTexto, entrega.bairro, entrega.cidade, entrega.uf].filter(Boolean).join(", ")}</span>
                        {entrega.googleMapsUrl && <small>Com link do Google Maps</small>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <form className={styles.entregaForm} onSubmit={criarEntrega}>
                <div className={styles.panelHeader}>
                  <h3 className={styles.panelTitle}>Entrega Manual</h3>
                  <button className={styles.confirmBtnSmall} disabled={loading}>{loading ? "..." : "Salvar"}</button>
                </div>

                <div className={styles.entregaFormGrid}>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Nº do pedido</label>
                    <input className={styles.input} value={formEntrega.numeroPedido} onChange={(e) => setFormEntrega({ ...formEntrega, numeroPedido: e.target.value })} required />
                  </div>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Cliente</label>
                    <input className={styles.input} value={formEntrega.clienteNome} onChange={(e) => setFormEntrega({ ...formEntrega, clienteNome: e.target.value })} required />
                  </div>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Telefone</label>
                    <input className={styles.input} value={formEntrega.telefone} onChange={(e) => setFormEntrega({ ...formEntrega, telefone: e.target.value })} />
                  </div>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>UF</label>
                    <input className={styles.input} value={formEntrega.uf} onChange={(e) => setFormEntrega({ ...formEntrega, uf: e.target.value.toUpperCase().slice(0, 2) })} />
                  </div>
                  <div className={`${styles.inputGroup} ${styles.fullSpan}`}>
                    <label className={styles.label}>Endereço</label>
                    <input className={styles.input} value={formEntrega.enderecoTexto} onChange={(e) => setFormEntrega({ ...formEntrega, enderecoTexto: e.target.value })} required />
                  </div>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Bairro</label>
                    <input className={styles.input} value={formEntrega.bairro} onChange={(e) => setFormEntrega({ ...formEntrega, bairro: e.target.value })} />
                  </div>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Cidade</label>
                    <input className={styles.input} value={formEntrega.cidade} onChange={(e) => setFormEntrega({ ...formEntrega, cidade: e.target.value })} />
                  </div>
                  <div className={`${styles.inputGroup} ${styles.fullSpan}`}>
                    <label className={styles.label}>Link Google Maps</label>
                    <input className={styles.input} value={formEntrega.googleMapsUrl} onChange={(e) => setFormEntrega({ ...formEntrega, googleMapsUrl: e.target.value })} placeholder="https://maps.app.goo.gl/..." />
                  </div>
                  <div className={`${styles.inputGroup} ${styles.fullSpan}`}>
                    <label className={styles.label}>Pagamento</label>
                    <input className={styles.input} value={formEntrega.pagamento} onChange={(e) => setFormEntrega({ ...formEntrega, pagamento: e.target.value })} />
                  </div>
                  <div className={`${styles.inputGroup} ${styles.fullSpan}`}>
                    <label className={styles.label}>Observações</label>
                    <textarea className={styles.modalTextarea} value={formEntrega.observacoes} onChange={(e) => setFormEntrega({ ...formEntrega, observacoes: e.target.value })} />
                  </div>
                  <div className={`${styles.inputGroup} ${styles.fullSpan}`}>
                    <label className={styles.label}>Motorista</label>
                    <select className={styles.input} value={formEntrega.motoristaSpokeId} onChange={(e) => setFormEntrega({ ...formEntrega, motoristaSpokeId: e.target.value })} required>
                      <option value="">Selecione</option>
                      {motoristasSpoke.filter((m) => m.active).map((m) => (
                        <option key={m.id} value={m.id}>{m.displayName || m.name || m.id}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </form>
              </div>

            <div className={styles.entregasList}>
              <div className={styles.panelHeader}>
                <h3 className={styles.panelTitle}>Entregas ({entregas.length})</h3>
                <div className={styles.entregaInlineActions}>
                  <button className={styles.syncBtn} onClick={() => carregarEntregas()}>Atualizar</button>
                  <button
                    className={styles.confirmBtnSmall}
                    onClick={criarRotaUnicaPendentes}
                    disabled={loading || entregasPendentesMotorista.length === 0}
                  >
                    Rota única pendentes ({entregasPendentesMotorista.length})
                  </button>
                </div>
              </div>
              {entregas.length === 0 ? (
                <div className={styles.emptyTable}>Nenhuma rota cadastrada.</div>
              ) : entregas.map((entrega) => (
                <div key={entrega.id} className={styles.entregaCard}>
                  <div className={styles.entregaCardHeader}>
                    <div>
                      <span className={styles.prodName}>Pedido {entrega.numeroPedido}</span>
                      <span className={styles.userName}>{entrega.clienteNome} · {entrega.motoristaNome || "Sem motorista"}</span>
                    </div>
                    <span className={styles.statusBadge} data-status={entrega.status}>{entrega.status}</span>
                  </div>
                  <p className={styles.entregaAddress}>{[entrega.enderecoTexto, entrega.bairro, entrega.cidade, entrega.uf].filter(Boolean).join(", ")}</p>
                  {entrega.latitude && entrega.longitude && (
                    <p className={styles.entregaMeta}>Coordenada: {Number(entrega.latitude).toFixed(6)}, {Number(entrega.longitude).toFixed(6)}</p>
                  )}
                  {entrega.statusDetalhe && <p className={styles.entregaMeta}>{entrega.statusDetalhe}</p>}
                  {entrega.trackingLink && (
                    <a href={entrega.trackingLink} target="_blank" rel="noopener noreferrer" className={styles.trackingLink}>Abrir tracking</a>
                  )}
                  <div className={styles.entregaActions}>
                    <button onClick={() => acaoEntrega(entrega.id, "criar-rota")} className={styles.userActionBtn} disabled={loading || !!entrega.planSpokeId}>Criar rota</button>
                    <button onClick={() => acaoEntrega(entrega.id, "distribuir")} className={styles.userActionBtn} disabled={loading || !entrega.planSpokeId || entrega.status === "DISTRIBUIDA"}>Distribuir</button>
                    <button onClick={() => acaoEntrega(entrega.id, "finalizar")} className={styles.userActionBtn} disabled={loading || !entrega.planSpokeId}>Finalizar</button>
                    <button onClick={() => excluirEntrega(entrega)} className={`${styles.userActionBtn} ${styles.userActionBtnDanger}`} disabled={loading}>Excluir</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : abaAtiva === "relatorios" ? (
          <div className={styles.configArea}>
            <h2 className={styles.panelTitle}>Central de Relatórios</h2>
            <div className={styles.kpiGrid}>
              <div className={styles.configCard} style={{ cursor: 'pointer' }} onClick={() => exportarRelatorio('divergencias')}>
                <h3 className={styles.configTitle}>
                  <Icons.Reports className="w-6 h-6 inline mr-2 text-primary" /> Divergências
                </h3>
                <p className={styles.configSubtitle}>Exporta histórico de erros e resoluções.</p>
                <button className={styles.confirmBtnSmall} style={{ marginTop: '16px', display: 'block', width: '100%' }}>Download CSV</button>
              </div>
              <div className={styles.configCard} style={{ cursor: 'pointer' }} onClick={() => exportarRelatorio('produtividade')}>
                <h3 className={styles.configTitle}>
                  <Icons.Users className="w-6 h-6 inline mr-2 text-success" /> Produtividade
                </h3>
                <p className={styles.configSubtitle}>Contagens realizadas e tempos por operador.</p>
                <button className={styles.confirmBtnSmall} style={{ marginTop: '16px', display: 'block', width: '100%' }}>Download CSV</button>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.configArea}>
            <h2 className={styles.panelTitle}>Configurações</h2>
            <div className={styles.configCard}>
              <h3 className={styles.configTitle}>Meta Diária Global</h3>
              <div className={styles.configAction}>
                <input type="number" value={metaGlobalEdit} onChange={e => setMetaGlobalEdit(Number(e.target.value))} className={styles.input} />
                <button onClick={salvarMetaGlobal} className={styles.confirmBtnSmall}>Salvar</button>
              </div>
              <button onClick={handleResetCycle} className={styles.resetBtn} style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                <Icons.Trash className="w-4 h-4" /> Encerrar Ciclo Atual
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <main className={moduloAtivo === "operador" || !token ? styles.main : styles.mainFull} data-build={FRONTEND_BUILD_MARKER}>
      {content}

      {/* Modal de Reporte */}
      {showModalReportar && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <h3>⚠️ Reportar Problema</h3>
            <textarea
              className={styles.modalTextarea}
              placeholder="Descreva o problema..."
              value={motivoReporte}
              onChange={(e) => setMotivoReporte(e.target.value)}
            />
            <div className={styles.modalActions}>
              <button onClick={() => setShowModalReportar(false)}>Cancelar</button>
              <button onClick={confirmarReporte} className={styles.saveBtn}>Enviar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Usuário */}
      {showModalUsuario && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <h3>{usuarioEdit ? 'Editar Usuário' : 'Novo Usuário'}</h3>
            <div className={styles.form}>
              <input type="text" placeholder="Nome Completo" value={formUsuario.nome} onChange={e => setFormUsuario({ ...formUsuario, nome: e.target.value })} className={styles.input} />
              {!usuarioEdit && (
                <>
                  <input type="text" placeholder="Login" value={formUsuario.login} onChange={e => setFormUsuario({ ...formUsuario, login: e.target.value })} className={styles.input} />
                  <input type="password" placeholder="Senha" value={formUsuario.senha} onChange={e => setFormUsuario({ ...formUsuario, senha: e.target.value })} className={styles.input} />
                </>
              )}
              <input
                type="number"
                placeholder="Cód. Usuário Sankhya (opcional)"
                value={formUsuario.codusuSankhya}
                onChange={e => setFormUsuario({ ...formUsuario, codusuSankhya: e.target.value })}
                className={styles.input}
              />
              <select value={formUsuario.role} onChange={e => setFormUsuario({ ...formUsuario, role: e.target.value as any })} className={styles.input}>
                <option value="OPERADOR">Operador</option>
                <option value="SUPERVISOR">Supervisor</option>
                <option value="ADMIN">Administrador</option>
              </select>
            </div>
            {error && <p className={styles.errorMsg}>{error}</p>}
            <div className={styles.modalActions}>
              <button onClick={() => setShowModalUsuario(false)}>Cancelar</button>
              <button onClick={handleSalvarUsuario} className={styles.saveBtn}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
