"use client";

import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  Input,
  Badge,
  Alert,
  AlertDescription,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@ecoledigitale/ui";
import { Users, Wallet, AlertTriangle, Search, CheckCircle2, Clock, FileText, Download, GraduationCap } from "lucide-react";
import { useClasses } from "@/lib/hooks/use-classes";
import { useEnrollments } from "@/lib/hooks/use-enrollments";
import React from "react";

const API_BASE_URL = "";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XOF", minimumFractionDigits: 0 }).format(amount || 0);
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount || 0);
}

type FeeType = "inscription" | "scolarite" | "annexes" | "autres";

export default function AdminStudentPaymentsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [encaisserOpen, setEncaisserOpen] = useState(false);
  const [feeType, setFeeType] = useState<FeeType>("inscription");
  const [paymentMethod, setPaymentMethod] = useState("orange_money");
  const [amount, setAmount] = useState<number>(0);
  const [selectedInstallmentId, setSelectedInstallmentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fetch classes
  const { data: classesData } = useClasses({ includeDetails: true });
  const classes = classesData?.data || [];

  // Fetch enrollments only after a class is selected (no global student list)
  const {
    data: enrollmentsData,
    isLoading: isLoadingEnrollments,
    error: enrollmentsError,
  } = useEnrollments(
    selectedClassId ? { classId: selectedClassId, limit: 100 } : {},
    { enabled: !!selectedClassId },
  );

  // Extract students from enrollments if class is selected
  const classStudents = React.useMemo(() => {
    if (!selectedClassId || !enrollmentsData?.data || !Array.isArray(enrollmentsData.data)) {
      return [];
    }
    
    const studentsMap = new Map();
    
    enrollmentsData.data.forEach((enrollment: any) => {
      if (enrollment.student && enrollment.student.id) {
        const studentId = enrollment.student.id;
        
        if (!studentsMap.has(studentId)) {
          studentsMap.set(studentId, {
            id: studentId,
            user: {
              firstName: enrollment.student.firstName || '',
              lastName: enrollment.student.lastName || '',
              email: enrollment.student.email || '',
              name: enrollment.student.firstName && enrollment.student.lastName
                ? `${enrollment.student.firstName} ${enrollment.student.lastName}`
                : enrollment.student.email || `Étudiant ${studentId.slice(0, 8)}`
            },
            studentNumber: enrollment.student.studentNumber || '',
            matricule: enrollment.student.studentNumber || ''
          });
        }
      }
    });
    
    return Array.from(studentsMap.values());
  }, [enrollmentsData, selectedClassId]);

  const allStudents = selectedClassId ? classStudents : [];
  
  // Filter students by search term
  const students = React.useMemo(() => {
    if (!search) return allStudents;
    
    const searchLower = search.toLowerCase();
    return allStudents.filter((s: any) => {
      const firstName = s.user?.firstName?.toLowerCase() || '';
      const lastName = s.user?.lastName?.toLowerCase() || '';
      const email = s.user?.email?.toLowerCase() || '';
      const studentNumber = (s.studentNumber || s.matricule || '').toLowerCase();
      const name = s.user?.name?.toLowerCase() || '';
      
      return firstName.includes(searchLower) ||
             lastName.includes(searchLower) ||
             email.includes(searchLower) ||
             studentNumber.includes(searchLower) ||
             name.includes(searchLower);
    });
  }, [allStudents, search]);

  const isLoadingStudents = !!selectedClassId && isLoadingEnrollments;
  const studentsError = selectedClassId ? enrollmentsError : null;

  const {
    data: summary,
    isLoading: loadingSummary,
    error: summaryError,
  } = useQuery({
    queryKey: ["student-payments-admin-summary", selectedStudentId],
    enabled: !!selectedStudentId,
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/v1/student-payments/${selectedStudentId}`, {
        headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      const json = await res.json();
      return json.data;
    },
  });

  // Helper function to calculate outstanding amount for a fee type based on all transactions
  const calculateOutstandingForFeeType = (feeType: FeeType) => {
    if (!summary) return 0;
    
    const fees = (summary as any).fees || {};
    const transactions = (summary as any).recentTransactions || [];
    
    // Get the total fee amount for this type
    const totalAmount = feeType === "scolarite"
      ? Number(fees.scolarite ?? fees["scolarité"] ?? fees.SCOLARITE ?? 0)
      : Number(fees[feeType] || 0);
    
    // Calculate total paid from all completed transactions for this fee type
    const totalPaid = transactions
      .filter((tx: any) => tx.feeType === feeType && tx.status === "completed")
      .reduce((sum: number, tx: any) => sum + Number(tx.amount || 0), 0);
    
    console.log(`Calculating outstanding for ${feeType}:`, {
      totalAmount,
      totalPaid,
      transactions: transactions.filter((tx: any) => tx.feeType === feeType),
      outstanding: Math.max(0, totalAmount - totalPaid)
    });
    
    return Math.max(0, totalAmount - totalPaid);
  };

  // Compute default outstanding amounts
  const outstandingByFee = useMemo(() => {
    if (!summary) return {} as any;
    const out: any = {};
    
    ["inscription", "annexes", "autres"].forEach((k) => {
      out[k] = calculateOutstandingForFeeType(k as FeeType);
    });
    
    return out as Record<Exclude<FeeType, "scolarite">, number>;
  }, [summary]);

  const initialFeeRows = useMemo(() => {
    const fees = (summary as any)?.fees || {};
    const getAmount = (key: FeeType) =>
      key === "scolarite"
        ? Number(fees.scolarite ?? fees["scolarité"] ?? fees.SCOLARITE ?? 0)
        : Number(fees[key] || 0);

    return ([
      { key: "inscription", label: "Inscription" },
      { key: "scolarite", label: "Scolarité" },
      { key: "annexes", label: "Annexes" },
      { key: "autres", label: "Autres" },
    ] as const).map((item) => {
      const amount = getAmount(item.key);
      const remaining = calculateOutstandingForFeeType(item.key);
      return {
        ...item,
        amount,
        remaining,
        settled: amount > 0 && remaining <= 0,
      };
    });
  }, [summary]);

  // réinitialiser le montant par défaut quand le résumé est chargé ou change
  useEffect(() => {
    if (!summary) return;
    // si un étudiant est sélectionné et le dialogue est ouvert, recalcule selon le type courant
    if (encaisserOpen) {
      if (feeType === "scolarite") {
        const nextInst = summary?.tuitionInstallments?.find((i: any) => Number(i.amount) > Number(i.amountPaid));
        const due = nextInst
          ? Math.max(0, Number(nextInst.amount) - Number(nextInst.amountPaid))
          : calculateOutstandingForFeeType("scolarite");
        setAmount(due);
      } else {
        // Use the helper function to calculate outstanding amount
        const outstanding = calculateOutstandingForFeeType(feeType);
        setAmount(outstanding);
      }
    }
  }, [summary, encaisserOpen, feeType]);

  // quand on change de type de frais, recalcule de façon robuste même si outstandingByFee vaut 0
  useEffect(() => {
    if (!encaisserOpen || !summary) return;
    if (feeType === "scolarite") {
      const nextInst = summary?.tuitionInstallments?.find((i: any) => Number(i.amount) > Number(i.amountPaid));
      const due = nextInst
        ? Math.max(0, Number(nextInst.amount) - Number(nextInst.amountPaid))
        : calculateOutstandingForFeeType("scolarite");
      setAmount(due);
      setSelectedInstallmentId(nextInst?.id || null);
    } else {
      // Use the helper function to calculate outstanding amount
      const outstanding = calculateOutstandingForFeeType(feeType);
      setAmount(outstanding);
      setSelectedInstallmentId(null);
    }
  }, [feeType, encaisserOpen, summary]);

  function openEncaisserDialog() {
    if (!summary || !selectedStudentId) return;
    setErrorMsg(null);
    
    // Find the first fee type with outstanding amount
    let defaultType: FeeType = "inscription";
    let maxOutstanding = 0;
    
    ["inscription", "annexes", "autres"].forEach((k) => {
      const outstanding = calculateOutstandingForFeeType(k as FeeType);
      if (outstanding > maxOutstanding) {
        maxOutstanding = outstanding;
        defaultType = k as FeeType;
      }
    });
    
    // If no immediate fees have outstanding amounts, default to scolarite
    if (maxOutstanding === 0) {
      defaultType = "scolarite";
    }
    
    setFeeType(defaultType);

    if (defaultType === "scolarite") {
      const nextInst = summary?.tuitionInstallments?.find((i: any) => Number(i.amount) > Number(i.amountPaid));
      setSelectedInstallmentId(nextInst?.id || null);
      const due = nextInst
        ? Math.max(0, Number(nextInst.amount) - Number(nextInst.amountPaid))
        : calculateOutstandingForFeeType("scolarite");
      setAmount(due);
    } else {
      setSelectedInstallmentId(null);
      // Calculate the outstanding amount for the selected fee type
      const outstanding = calculateOutstandingForFeeType(defaultType);
      setAmount(outstanding);
    }

    setEncaisserOpen(true);
  }

  async function handleInitiatePayment() {
    if (!summary || !selectedStudentId) return;
    
    // Frontend validation
    const paymentAmount = Number(amount || 0);
    if (paymentAmount <= 0) {
      setErrorMsg("Le montant doit être supérieur à 0");
      return;
    }

    setBusy(true);
    setErrorMsg(null);
    try {
      const body: any = {
        studentId: selectedStudentId,
        enrollmentId: summary.enrollmentId,
        feeType,
        amount: paymentAmount,
        currency: "XOF",
        paymentMethod: paymentMethod,
        returnUrl: typeof window !== "undefined" ? window.location.href : undefined,
      };
      if (feeType === "scolarite") body.tuitionInstallmentId = selectedInstallmentId;

      const res = await fetch(`${API_BASE_URL}/api/v1/student-payments/initiate`, {
        method: "POST",
        headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      
      if (!res.ok) {
        // Enhanced error handling with detailed messages
        let errorMessage = json.message || "Échec de l'initiation du paiement";
        
        // Add context from error details if available
        if (json.details) {
          const details = json.details;
          if (details.outstanding !== undefined) {
            errorMessage += `\n\nMontant restant à payer: ${formatCurrency(details.outstanding)}`;
          }
          if (details.configuredAmount !== undefined) {
            errorMessage += `\nMontant configuré: ${formatCurrency(details.configuredAmount)}`;
          }
          if (details.paidAmount !== undefined) {
            errorMessage += `\nMontant déjà payé: ${formatCurrency(details.paidAmount)}`;
          }
        }
        
        // Handle specific error codes
        if (json.errorCode === 'FEE_NOT_CONFIGURED') {
          errorMessage = `Les frais de type "${feeType}" ne sont pas configurés pour cet étudiant. Veuillez configurer les frais dans l'inscription.`;
        } else if (json.errorCode === 'ALREADY_FULLY_PAID') {
          errorMessage = `Les frais de type "${feeType}" sont déjà entièrement payés.`;
        } else if (json.errorCode === 'AMOUNT_EXCEEDS_OUTSTANDING') {
          errorMessage = `Le montant demandé (${formatCurrency(paymentAmount)}) dépasse le montant restant à payer.`;
          if (json.details?.outstanding !== undefined) {
            errorMessage += `\nMontant restant: ${formatCurrency(json.details.outstanding)}`;
          }
        }
        
        throw new Error(errorMessage);
      }

      // Open gateway URL if any
      const url = json?.data?.paymentUrl;
      if (url && typeof window !== "undefined") {
        window.open(url, "_blank");
      }
      // Refresh summary/transactions
      await queryClient.invalidateQueries({ queryKey: ["student-payments-admin-summary", selectedStudentId] });
      setEncaisserOpen(false);
    } catch (e: any) {
      setErrorMsg(e?.message || "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateReceipt(transactionId?: string) {
    try {
      if (!summary || !summary.recentTransactions?.length) return;
      
      // Use provided transactionId or find first completed transaction
      const txId = transactionId || summary.recentTransactions.find((t: any) => t.status === "completed")?.id || summary.recentTransactions[0]?.id;
      if (!txId) throw new Error("Aucune transaction disponible");
      
      const res = await fetch(`${API_BASE_URL}/api/v1/receipts/generate/${txId}?format=pdf`, {
        method: "POST",
        headers: {
          "X-Tenant": "imhotepacademy",
          "X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || "Échec de génération du reçu");
      const receiptUrl: string = json?.data?.receiptUrl;
      if (receiptUrl && typeof window !== "undefined") {
        const full = receiptUrl.startsWith("http") ? receiptUrl : `${API_BASE_URL}${receiptUrl}`;
        window.open(full, "_blank");
      }
    } catch (e) {
      alert((e as any)?.message || "Impossible de générer le reçu");
    }
  }

  return (
    <div className="container mx-auto px-6 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
            Paiements Étudiants
          </h1>
          <p className="text-muted-foreground mt-1">Rechercher un étudiant et gérer ses paiements</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Students list */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Étudiants
            </CardTitle>
            <CardDescription>
              Choisissez une classe, puis un étudiant pour voir les paiements
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Class Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <GraduationCap className="h-4 w-4" />
                Classe
              </label>
              <Select
                value={selectedClassId || undefined}
                onValueChange={(value) => {
                  setSelectedClassId(value);
                  setSelectedStudentId(null);
                  setSearch("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choisissez une classe" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((classItem: any) => (
                    <SelectItem key={classItem.id} value={classItem.id}>
                      {classItem.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher par nom, email, matricule..."
                className="pl-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                disabled={!selectedClassId}
              />
            </div>

            {isLoadingStudents ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Clock className="h-4 w-4 animate-spin" />
                  Chargement des étudiants...
                </div>
              </div>
            ) : studentsError ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>Erreur: {(studentsError as any).message}</AlertDescription>
              </Alert>
            ) : students.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                {!selectedClassId
                  ? "Sélectionnez une classe pour afficher les étudiants"
                  : search
                    ? "Aucun étudiant ne correspond à votre recherche"
                    : "Aucun étudiant trouvé dans cette classe"}
              </div>
            ) : (
              <div className="space-y-2 max-h-[480px] overflow-auto pr-2">
                <div className="text-xs text-muted-foreground mb-2 px-1">
                  {students.length} étudiant{students.length > 1 ? 's' : ''} {selectedClassId ? 'dans cette classe' : ''}
                </div>
                {students.map((s: any) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStudentId(s.id)}
                    className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                      selectedStudentId === s.id 
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-950/50 shadow-md" 
                        : "border-border hover:border-blue-300 hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className={`font-semibold text-sm truncate ${
                        selectedStudentId === s.id 
                          ? "text-blue-900 dark:text-blue-100" 
                          : "text-foreground"
                      }`}>
                        {s.user?.firstName} {s.user?.lastName}
                      </div>
                      {selectedStudentId === s.id && (
                        <CheckCircle2 className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: Summary */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              {selectedStudentId ? "Résumé des paiements" : "Sélectionnez un étudiant"}
            </CardTitle>
            <CardDescription>
              {selectedStudentId ? "Détails des frais, paiements et échéances" : "Choisissez un étudiant dans la liste à gauche"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedStudentId ? (
              <div className="text-muted-foreground">Aucun étudiant sélectionné.</div>
            ) : loadingSummary ? (
              <div className="text-sm text-muted-foreground">Chargement du résumé...</div>
            ) : summaryError ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>Erreur: {(summaryError as any).message}</AlertDescription>
              </Alert>
            ) : summary ? (
              <div className="space-y-6">
                {/* Totals */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total Frais</CardTitle>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">FCFA</Badge>
                      </div>
                      <div className="text-2xl font-bold mt-2">{formatAmount(summary.totalFees)}</div>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total Payé</CardTitle>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">FCFA</Badge>
                      </div>
                      <div className="text-2xl font-bold text-green-600 mt-2">{formatAmount(summary.totalPaid)}</div>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Reste à Payer</CardTitle>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">FCFA</Badge>
                      </div>
                      <div className="text-2xl font-bold text-red-600 mt-2">{formatAmount(summary.totalOutstanding)}</div>
                    </CardHeader>
                  </Card>
                </div>

                <Tabs defaultValue="immediate">
                  <TabsList>
                    <TabsTrigger value="immediate">Frais Immédiats</TabsTrigger>
                    <TabsTrigger value="tuition">Échéances Scolarité</TabsTrigger>
                    <TabsTrigger value="transactions">Transactions</TabsTrigger>
                  </TabsList>

                  <div className="mt-3 text-xs text-muted-foreground">
                    Détails des montants initiaux:
                    <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 mt-1 items-center">
                      {initialFeeRows.map((row) => (
                        <React.Fragment key={row.key}>
                          <div>{row.label}:</div>
                          <div className="text-right">{formatCurrency(row.amount)}</div>
                          {row.settled ? (
                            <Badge className="bg-green-100 text-green-800 border-green-200">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Réglé
                            </Badge>
                          ) : (
                            <Badge variant="outline">
                              Reste {formatCurrency(row.remaining)}
                            </Badge>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>

                  <TabsContent value="immediate" className="space-y-3">
                    {(["inscription", "scolarite", "annexes", "autres"] as const).map((key) => {
                      const item = summary.immediateFeesStatus?.[key as "inscription" | "annexes" | "autres"] || (key === "scolarite" ? { amount: (summary as any).fees?.scolarite ?? (summary as any).fees?.["scolarité"] ?? (summary as any).fees?.SCOLARITE ?? 0, paid: false, paidAmount: 0 } : undefined);
                      if (!item) return null;
                      const paid = !!item.paid;
                      const feeLabelMap: Record<string, string> = {
                        inscription: "Inscription",
                        scolarite: "Scolarité",
                        annexes: "Annexes",
                        autres: "Autres",
                      };

                      return (
                        <div key={key} className="flex items-center justify-between p-3 rounded-md border">
                          <div className="font-medium">{feeLabelMap[key] || key}</div>
                          <div className="flex items-center gap-4">
                            <div className="text-xs text-muted-foreground">Montant initial: {formatCurrency(Number(item.amount))}</div>
                            {key !== "scolarite" && (
                              <div className="text-xs text-muted-foreground">Payé: {formatCurrency(Number((item as any).paidAmount || 0))}</div>
                            )}
                            <Badge variant={paid ? "default" : "outline"} className={paid ? "bg-green-100 text-green-800" : ""}>
                              {paid ? (
                                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Payé</span>
                              ) : (
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> À payer</span>
                              )}
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                  </TabsContent>

                  <TabsContent value="tuition" className="space-y-3 max-h-[300px] overflow-auto pr-1">
                    {summary.tuitionInstallments?.length ? (
                      summary.tuitionInstallments.map((inst: any) => (
                        <div key={inst.id} className="flex items-center justify-between p-3 rounded-md border">
                          <div className="space-y-1">
                            <div className="font-medium">{inst.installmentLabel}</div>
                            <div className="text-xs text-muted-foreground">Échéance: {new Date(inst.dueDate).toLocaleDateString("fr-FR")}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-medium">{formatCurrency(inst.amount)}</div>
                            <div className="text-xs text-muted-foreground">Payé: {formatCurrency(inst.amountPaid)}</div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-muted-foreground">Aucune échéance trouvée</div>
                    )}
                  </TabsContent>

                  <TabsContent value="transactions" className="space-y-3 max-h-[300px] overflow-auto pr-1">
                    {summary.recentTransactions?.length ? (
                      summary.recentTransactions.map((tx: any) => (
                        <div key={tx.id} className="flex items-center justify-between p-3 rounded-md border">
                          <div className="space-y-0.5 flex-1">
                            <div className="font-medium flex items-center gap-2">
                              <FileText className="h-4 w-4" /> {tx.feeType}
                            </div>
                            <div className="text-xs text-muted-foreground">{new Date(tx.createdAt).toLocaleString("fr-FR")}</div>
                          </div>
                          <div className="text-right flex items-center gap-3">
                            <div>
                              <div className="font-medium">{formatCurrency(tx.amount)}</div>
                              <div className="text-xs text-muted-foreground">{tx.paymentMethod} â€¢ {tx.status}</div>
                            </div>
                            {tx.status === "completed" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleGenerateReceipt(tx.id)}
                                className="flex items-center gap-1"
                              >
                                <Download className="h-3 w-3" />
                                Reçu
                              </Button>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-muted-foreground">Aucune transaction récente</div>
                    )}
                  </TabsContent>
                </Tabs>

                <div className="flex gap-3 pt-2">
                  <Button disabled={!selectedStudentId} onClick={openEncaisserDialog}>Encaisser un paiement</Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Encaisser Dialog */}
      <Dialog open={encaisserOpen} onOpenChange={setEncaisserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Encaisser un paiement</DialogTitle>
            <DialogDescription>Sélectionnez le type de frais, la méthode et le montant</DialogDescription>
          </DialogHeader>

          {errorMsg ? (
            <Alert variant="destructive" className="mb-2">
              <AlertDescription className="whitespace-pre-line">{errorMsg}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Type de frais</label>
              <Select value={feeType} onValueChange={(v) => {
                const ft = v as FeeType; setFeeType(ft);
                if (ft === "scolarite") {
                  const nextInst = summary?.tuitionInstallments?.find((i: any) => Number(i.amount) > Number(i.amountPaid));
                  setSelectedInstallmentId(nextInst?.id || null);
                  const due = nextInst
                    ? Math.max(0, Number(nextInst.amount) - Number(nextInst.amountPaid))
                    : calculateOutstandingForFeeType("scolarite");
                  setAmount(due);
                } else {
                  setSelectedInstallmentId(null);
                  // Use the helper function to calculate outstanding amount
                  const outstanding = calculateOutstandingForFeeType(ft);
                  setAmount(outstanding);
                }
              }}>
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inscription">Inscription</SelectItem>
                  <SelectItem value="scolarite">Scolarité</SelectItem>
                  <SelectItem value="annexes">Annexes</SelectItem>
                  <SelectItem value="autres">Autres</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {feeType === "scolarite" ? (
              <div>
                <label className="text-sm text-muted-foreground">Échéance</label>
                {!(summary?.tuitionInstallments?.length) ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Aucune échéance trouvée. Le montant reste celui de la scolarité restante.
                  </p>
                ) : null}
                <Select value={selectedInstallmentId ?? undefined} onValueChange={(v) => {
                  setSelectedInstallmentId(v);
                  const inst = summary?.tuitionInstallments?.find((i: any) => i.id === v);
                  const due = inst
                    ? Math.max(0, Number(inst.amount) - Number(inst.amountPaid))
                    : calculateOutstandingForFeeType("scolarite");
                  setAmount(due);
                }}>
                  <SelectTrigger className="mt-1 w-full">
                    <SelectValue placeholder="Sélectionner une échéance" />
                  </SelectTrigger>
                  <SelectContent>
                    {summary?.tuitionInstallments?.map((inst: any) => (
                      <SelectItem key={inst.id} value={inst.id}>
                        {inst.installmentLabel} - reste {formatCurrency(Math.max(0, Number(inst.amount) - Number(inst.amountPaid)))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div>
              <label className="text-sm text-muted-foreground">Méthode de paiement</label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="especes">Espèces</SelectItem>
                  <SelectItem value="orange_money">Orange Money</SelectItem>
                  <SelectItem value="mtn_money">MTN Money</SelectItem>
                  <SelectItem value="moov_money">Moov Money</SelectItem>
                  <SelectItem value="card">Carte</SelectItem>
                  <SelectItem value="bank_transfer">Virement bancaire</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-muted-foreground">Montant</label>
              <Input type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value || 0))} />
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setEncaisserOpen(false)} disabled={busy}>Annuler</Button>
            <Button onClick={handleInitiatePayment} disabled={busy || !amount}>{busy ? "Traitement..." : "Confirmer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


