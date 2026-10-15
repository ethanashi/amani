#!/usr/bin/env Rscript
# Reference analysis (arm D) for starter study 1:
#   Venet, Dumont & Detours (2011) PLoS Comput Biol 7(10):e1002240 re-tested in METABRIC.
#
# Deterministic: fixed seed, fixed RNG kinds, single-threaded data.table and BLAS
# (pixi activation sets OPENBLAS_NUM_THREADS=1). No timestamps or paths in the outputs,
# so two runs on the same data produce byte-identical summary.json and draws.tsv.
#
# Usage (from packages/bio-baseline):
#   pixi run --frozen Rscript reference/venet_reference.R --data <dataset dir> --out <out dir>
#        [--draws 1000] [--seed 20111020] [--sizes 1,5,10,16,25,50,100,200,500]
#
# Method (primary):
#   * analysis set = expression samples whose patient has non-missing OS_MONTHS and an
#     OS_STATUS of "0:LIVING" or "1:DECEASED"; genes with no missing value and sd > 0.
#   * every gene z-scored across the analysis set.
#   * signature score = first principal component of the signature genes' z-scores
#     (Venet et al. summarise a signature by its first PC), standardised. A secondary score is
#     the mean z-score.
#   * association = two-sided Wald p of the score in a Cox model of overall survival (Efron ties).
#   * proliferation meta-gene (primary) = mean z-score of the 1% of genes most correlated with
#     the PAM50 11-gene proliferation cluster score in this dataset. Venet's meta-PCNA (1% of
#     genes most correlated with PCNA across a normal-tissue atlas) cannot be rebuilt offline,
#     and the literal within-METABRIC analogue (1% of genes most correlated with the PCNA probe)
#     does NOT track proliferation here: the PCNA probe co-expresses with housekeeping genes and
#     that meta-gene is not prognostic. It is kept as a reported sensitivity ("pcna"), as is the
#     11-gene cluster itself ("prolif11"). Adjusted p = Wald p of the score in Cox(score + meta).
#   * negative control = the same unadjusted test with survival rows permuted against expression.
#   * context (not asked of the arms): disease-specific survival (VITAL_STATUS "Died of Disease"
#     as event, other deaths censored), and OS adjusted for meta-gene + age at diagnosis.
#   * published comparators = PAM50 (50 genes) and the Oncotype DX 16 cancer genes.
suppressPackageStartupMessages({
  library(data.table)
  library(survival)
})

args <- commandArgs(trailingOnly = TRUE)
getarg <- function(name, default = NULL) {
  i <- match(paste0("--", name), args)
  if (is.na(i)) default else args[i + 1L]
}
data_dir <- getarg("data")
out_dir <- getarg("out")
draws <- as.integer(getarg("draws", "1000"))
seed <- as.integer(getarg("seed", "20111020"))
sizes <- as.integer(strsplit(getarg("sizes", "1,5,10,16,25,50,100,200,500"), ",", fixed = TRUE)[[1]])
if (is.null(data_dir) || is.null(out_dir)) stop("usage: --data <dir> --out <dir>")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
setDTthreads(1L)
RNGkind("Mersenne-Twister", "Inversion", "Rejection")

fmt <- function(x) ifelse(is.na(x), "NA", sprintf("%.6g", x))

# ---------------------------------------------------------------- load
clin <- fread(file.path(data_dir, "clinical_patient.tsv"), sep = "\t", colClasses = "character",
              na.strings = c("NA", ""))
samp <- fread(file.path(data_dir, "clinical_sample.tsv"), sep = "\t", colClasses = "character",
              na.strings = c("NA", ""))
expr <- fread(file.path(data_dir, "expression_mrna.tsv"), sep = "\t", na.strings = c("NA", ""))
sym <- as.character(expr[[1]])
entrez <- as.integer(expr[[2]])
M <- as.matrix(expr[, -(1:2)])
rm(expr); invisible(gc())
storage.mode(M) <- "double"
stopifnot(!anyDuplicated(entrez), !anyDuplicated(colnames(M)), !anyDuplicated(clin$PATIENT_ID))

n_expr_samples <- ncol(M)
s2p <- samp$PATIENT_ID[match(colnames(M), samp$SAMPLE_ID)]
pidx <- match(s2p, clin$PATIENT_ID)
time <- suppressWarnings(as.numeric(clin$OS_MONTHS[pidx]))
st <- clin$OS_STATUS[pidx]
event <- ifelse(st %in% "1:DECEASED", 1L, ifelse(st %in% "0:LIVING", 0L, NA_integer_))
drop_no_patient <- sum(is.na(pidx))
drop_no_os <- sum(!is.na(pidx) & (is.na(time) | is.na(event)))
drop_negative_time <- sum(!is.na(time) & time < 0)
keep <- !is.na(pidx) & !is.na(time) & !is.na(event) & time >= 0
if (anyDuplicated(s2p[keep])) stop("more than one expression sample per patient; refuse to guess")

Mk <- M[, keep, drop = FALSE]
rm(M); invisible(gc())
time <- time[keep]; event <- event[keep]
vital <- clin$VITAL_STATUS[pidx][keep]
age <- suppressWarnings(as.numeric(clin$AGE_AT_DIAGNOSIS[pidx][keep]))
n <- ncol(Mk)
complete <- rowSums(is.na(Mk)) == 0
sds <- apply(Mk, 1, sd)
gkeep <- complete & !is.na(sds) & sds > 0
genes_dropped_missing <- sum(!complete)
genes_dropped_constant <- sum(complete & !(sds > 0))
Mk <- Mk[gkeep, , drop = FALSE]
sym <- sym[gkeep]; entrez <- entrez[gkeep]
G <- nrow(Mk)

# Duplicate expression profiles (QC, reported, not removed): random projection, exact confirm.
set.seed(1L)
proj <- as.vector(crossprod(Mk, rnorm(G)))
cand <- which(duplicated(proj) | duplicated(proj, fromLast = TRUE))
dup_pairs <- 0L
if (length(cand)) {
  key <- split(cand, proj[cand])
  for (grp in key) if (length(grp) > 1) {
    for (j in grp[-1]) if (identical(Mk[, grp[1]], Mk[, j])) dup_pairs <- dup_pairs + 1L
  }
}

Z <- scale(t(Mk))            # n x G, columns z-scored
attributes(Z)[c("scaled:center", "scaled:scale")] <- NULL
dimnames(Z) <- NULL
rm(Mk); invisible(gc())
y <- Surv(time, event)
dss_ok <- vital %in% c("Living", "Died of Disease", "Died of Other Causes")
y_dss <- Surv(time[dss_ok], as.integer(vital[dss_ok] == "Died of Disease"))
dss_avail <- sum(dss_ok) >= 20L && sum(vital[dss_ok] == "Died of Disease") >= 5L
na2 <- c(hr = NA_real_, p = NA_real_)
age_ok <- !is.na(age)
if (!all(age_ok)) stop("missing age at diagnosis in the analysis set; refuse to guess")
age_z <- (age - mean(age)) / sd(age)

# ---------------------------------------------------------------- helpers
std <- function(s) (s - mean(s)) / sd(s)
pc1 <- function(X) {
  if (ncol(X) == 1L) return(X[, 1])
  v <- eigen(crossprod(X), symmetric = TRUE)$vectors[, 1]
  s <- as.vector(X %*% v)
  if (sum(s * rowMeans(X)) < 0) s <- -s   # sign convention only; two-sided p is unaffected
  s
}
ctl <- coxph.control()
cox_warnings <- new.env()
cox_warnings$n <- 0L
cox_warnings$msgs <- character(0)
cox1 <- function(X, yy) {
  X <- as.matrix(X)
  # Count (do not hide) fitter warnings; in practice "Loglik converged before variable 1",
  # which coxph emits when the optimum is at the start value (coefficient ~ 0, p ~ 1).
  fit <- withCallingHandlers(
    coxph.fit(x = X, y = yy, strata = NULL, offset = NULL, init = NULL, control = ctl,
              weights = NULL, method = "efron", rownames = NULL, resid = FALSE),
    warning = function(w) {
      cox_warnings$n <- cox_warnings$n + 1L
      cox_warnings$msgs <- unique(c(cox_warnings$msgs, trimws(conditionMessage(w))))
      invokeRestart("muffleWarning")
    })
  b <- unname(fit$coefficients[1])
  se <- sqrt(fit$var[1, 1])
  c(hr = exp(b), p = 2 * pnorm(-abs(b / se)))
}
col_of <- function(symbols) {
  idx <- match(symbols, sym)
  list(found = symbols[!is.na(idx)], missing = symbols[is.na(idx)], idx = idx[!is.na(idx)])
}

# ---------------------------------------------------------------- proliferation meta-genes
n_meta <- ceiling(0.01 * G)
top_by_r <- function(v) {
  r <- as.vector(crossprod(Z, v)) / (n - 1)
  order(-r, entrez)[seq_len(n_meta)]
}
prolif11_syms <- c("BIRC5", "CCNB1", "CDC20", "NUF2", "CEP55", "NDC80", "MKI67", "PTTG1",
                   "RRM2", "TYMS", "UBE2C")
p11 <- col_of(prolif11_syms)
if (length(p11$idx) < 6L) stop("fewer than 6 of the 11 proliferation genes present; refuse")
prolif11 <- std(rowMeans(Z[, p11$idx, drop = FALSE]))
meta_idx <- top_by_r(prolif11)
meta <- std(rowMeans(Z[, meta_idx, drop = FALSE]))
pcna <- match(5111L, entrez)
if (is.na(pcna)) stop("PCNA (Entrez 5111) not in the analysis gene set")
pcna_idx <- top_by_r(Z[, pcna])
meta_pcna <- std(rowMeans(Z[, pcna_idx, drop = FALSE]))

# Cross-check the fast fitter against coxph() once (fail closed if they disagree).
chk <- std(Z[, pcna])
fast <- cox1(cbind(chk, meta), y)
slow <- summary(coxph(y ~ chk + meta, ties = "efron"))$coefficients[1, "Pr(>|z|)"]
if (abs(fast[["p"]] - slow) > 1e-10 * max(1, slow)) stop("coxph.fit and coxph disagree")

# ---------------------------------------------------------------- published signatures (lists)
pam50 <- c("ACTR3B", "ANLN", "BAG1", "BCL2", "BIRC5", "BLVRA", "CCNB1", "CCNE1", "CDC20", "CDC6",
           "CDH3", "CENPF", "CEP55", "CXXC5", "EGFR", "ERBB2", "ESR1", "EXO1", "FGFR4", "FOXA1",
           "FOXC1", "GPR160", "GRB7", "KIF2C", "KRT14", "KRT17", "KRT5", "MAPT", "MDM2", "MELK",
           "MIA", "MKI67", "MLPH", "MMP11", "MYBL2", "MYC", "NAT1", "NDC80", "NUF2", "ORC6",
           "PGR", "PHGDH", "PTTG1", "RRM2", "SFRP1", "SLC39A6", "TMEM45B", "TYMS", "UBE2C", "UBE2T")
oncotype16 <- c("MKI67", "AURKA", "BIRC5", "CCNB1", "MYBL2", "MMP11", "CTSV", "ERBB2", "GRB7",
                "ESR1", "PGR", "BCL2", "SCUBE2", "GSTM1", "CD68", "BAG1")
published <- list(PAM50 = pam50, OncotypeDX_16_cancer_genes = oncotype16)
pub_sizes <- vapply(published, function(v) length(col_of(v)$idx), 1L)
sizes <- sort(unique(c(sizes, pub_sizes[pub_sizes > 0L])))   # random draws exist at each published size

# ---------------------------------------------------------------- random signatures
set.seed(seed)
rows <- vector("list", length(sizes))
for (si in seq_along(sizes)) {
  s <- sizes[si]
  out <- matrix(NA_real_, nrow = draws, ncol = 14)
  for (b in seq_len(draws)) {
    g <- sample.int(G, s)
    perm <- sample.int(n)
    X <- Z[, g, drop = FALSE]
    pc <- std(pc1(X))
    mz <- std(rowMeans(X))
    u <- cox1(pc, y)
    a <- cox1(cbind(pc, meta), y)
    a11 <- cox1(cbind(pc, prolif11), y)
    apc <- cox1(cbind(pc, meta_pcna), y)
    mu <- cox1(mz, y)
    ma <- cox1(cbind(mz, meta), y)
    pp <- cox1(pc, y[perm])
    du <- if (dss_avail) cox1(pc[dss_ok], y_dss) else na2
    da <- if (dss_avail) cox1(cbind(pc, meta)[dss_ok, , drop = FALSE], y_dss) else na2
    aa <- cox1(cbind(pc, meta, age_z), y)
    out[b, ] <- c(s, b, u[["p"]], a[["p"]], a11[["p"]], apc[["p"]], mu[["p"]], ma[["p"]], pp[["p"]],
                  du[["p"]], da[["p"]], aa[["p"]], u[["hr"]], a[["hr"]])
  }
  rows[[si]] <- out
}
D <- do.call(rbind, rows)
colnames(D) <- c("size", "draw", "p_pc1", "p_pc1_adj_meta", "p_pc1_adj_prolif11", "p_pc1_adj_pcna",
                 "p_meanz", "p_meanz_adj_meta", "p_pc1_permuted", "p_pc1_dss", "p_pc1_dss_adj_meta",
                 "p_pc1_adj_meta_age", "hr_pc1", "hr_pc1_adj_meta")
Dt <- as.data.table(D)
dt_out <- copy(Dt)
for (cc in names(dt_out)[-(1:2)]) set(dt_out, j = cc, value = fmt(dt_out[[cc]]))
dt_out[, size := as.integer(size)][, draw := as.integer(draw)]
fwrite(dt_out, file.path(out_dir, "draws.tsv"), sep = "\t", quote = FALSE)

share <- function(p) mean(p < 0.05)
by_size <- Dt[, .(draws = .N,
                  share_p05_pc1 = share(p_pc1),
                  share_p05_pc1_adj_meta = share(p_pc1_adj_meta),
                  share_p05_pc1_adj_prolif11 = share(p_pc1_adj_prolif11),
                  share_p05_pc1_adj_pcna = share(p_pc1_adj_pcna),
                  share_p05_meanz = share(p_meanz),
                  share_p05_meanz_adj_meta = share(p_meanz_adj_meta),
                  share_p05_permuted = share(p_pc1_permuted),
                  share_p05_dss = share(p_pc1_dss),
                  share_p05_dss_adj_meta = share(p_pc1_dss_adj_meta),
                  share_p05_pc1_adj_meta_age = share(p_pc1_adj_meta_age),
                  median_p_pc1 = median(p_pc1),
                  median_p_pc1_adj_meta = median(p_pc1_adj_meta)), by = size]

# ---------------------------------------------------------------- published signatures (tests)
pub <- list()
for (nm in names(published)) {
  cg <- col_of(published[[nm]])
  if (length(cg$idx) == 0L) {
    pub[[nm]] <- list(n_genes_listed = length(published[[nm]]), n_genes_used = 0L, missing = cg$missing)
    next
  }
  X <- Z[, cg$idx, drop = FALSE]
  pc <- std(pc1(X)); mz <- std(rowMeans(X))
  u <- cox1(pc, y); a <- cox1(cbind(pc, meta), y); mu <- cox1(mz, y); ma <- cox1(cbind(mz, meta), y)
  a11 <- cox1(cbind(pc, prolif11), y)
  k <- length(cg$idx)
  ref <- Dt[size == k]
  pub[[nm]] <- list(
    n_genes_listed = length(published[[nm]]), n_genes_used = k, missing = cg$missing,
    p_pc1 = u[["p"]], hr_pc1 = u[["hr"]], p_pc1_adj_meta = a[["p"]], p_pc1_adj_prolif11 = a11[["p"]],
    p_meanz = mu[["p"]], p_meanz_adj_meta = ma[["p"]],
    share_random_same_size_p_le_published = if (nrow(ref)) mean(ref$p_pc1 <= u[["p"]]) else NA_real_,
    share_random_same_size_p_le_published_adj = if (nrow(ref)) mean(ref$p_pc1_adj_meta <= a[["p"]]) else NA_real_)
}
meta_alone <- cox1(meta, y)
p11_alone <- cox1(prolif11, y)
pcna_alone <- cox1(meta_pcna, y)

# ---------------------------------------------------------------- JSON (hand-rolled, stable)
js <- function(x) {
  if (is.null(x)) return("null")
  if (is.list(x)) {
    if (!is.null(names(x))) {
      parts <- vapply(names(x), function(k) paste0("\"", k, "\": ", js(x[[k]])), "")
      return(paste0("{", paste(parts, collapse = ", "), "}"))
    }
    return(paste0("[", paste(vapply(x, js, ""), collapse = ", "), "]"))
  }
  if (is.character(x)) {
    v <- paste0("\"", gsub("\"", "\\\\\"", x), "\"")
    return(if (length(x) == 1) v else paste0("[", paste(v, collapse = ", "), "]"))
  }
  if (is.logical(x)) { v <- ifelse(x, "true", "false"); return(if (length(x) == 1) v else paste0("[", paste(v, collapse = ", "), "]")) }
  if (is.integer(x)) { v <- as.character(x); return(if (length(x) == 1) v else paste0("[", paste(v, collapse = ", "), "]")) }
  v <- ifelse(is.na(x), "null", sprintf("%.6g", x))
  if (length(x) == 1) v else paste0("[", paste(v, collapse = ", "), "]")
}
summary_obj <- list(
  study = "Venet et al. 2011 re-test, METABRIC overall survival",
  method = list(score = "PC1 of z-scored signature genes (secondary: mean z)",
                test = "two-sided Wald p, Cox PH, Efron ties",
                meta_gene = "mean z of top 1% genes by Pearson r with the PAM50 11-gene proliferation score (within dataset)",
                seed = seed, draws_per_size = draws, sizes = sizes),
  analysis_set = list(expression_samples = n_expr_samples, n_patients = n,
                      n_events = as.integer(sum(event)),
                      n_dss_patients = as.integer(sum(dss_ok)),
                      n_dss_events = as.integer(sum(vital[dss_ok] == "Died of Disease")),
                      dropped_no_clinical_match = as.integer(drop_no_patient),
                      dropped_missing_os = as.integer(drop_no_os),
                      dropped_negative_time = as.integer(drop_negative_time),
                      genes_in_file = length(gkeep), genes_used = G,
                      genes_dropped_missing = as.integer(genes_dropped_missing),
                      genes_dropped_constant = as.integer(genes_dropped_constant),
                      duplicate_expression_profiles = dup_pairs),
  cox_fit_warnings = list(count = cox_warnings$n, messages = sort(cox_warnings$msgs)),
  meta_gene = list(n_genes = n_meta, top_genes = sym[meta_idx][1:min(20, n_meta)],
                   p_alone = meta_alone[["p"]], hr_alone = meta_alone[["hr"]],
                   prolif11_found = p11$found, prolif11_p_alone = p11_alone[["p"]],
                   prolif11_hr_alone = p11_alone[["hr"]],
                   pcna_seeded_top_genes = sym[pcna_idx][1:min(20, n_meta)],
                   pcna_seeded_p_alone = pcna_alone[["p"]], pcna_seeded_hr_alone = pcna_alone[["hr"]],
                   overlap_meta_vs_pcna_seeded = length(intersect(meta_idx, pcna_idx))),
  random_signatures = lapply(seq_len(nrow(by_size)), function(i) {
    r <- by_size[i]
    list(size = as.integer(r$size), draws = as.integer(r$draws),
         share_p05_pc1 = r$share_p05_pc1, share_p05_pc1_adj_meta = r$share_p05_pc1_adj_meta,
         share_p05_pc1_adj_prolif11 = r$share_p05_pc1_adj_prolif11,
         share_p05_pc1_adj_pcna = r$share_p05_pc1_adj_pcna,
         share_p05_meanz = r$share_p05_meanz, share_p05_meanz_adj_meta = r$share_p05_meanz_adj_meta,
         share_p05_permuted = r$share_p05_permuted,
         share_p05_dss = r$share_p05_dss, share_p05_dss_adj_meta = r$share_p05_dss_adj_meta,
         share_p05_pc1_adj_meta_age = r$share_p05_pc1_adj_meta_age,
         median_p_pc1 = r$median_p_pc1, median_p_pc1_adj_meta = r$median_p_pc1_adj_meta)
  }),
  published_signatures = pub
)
writeLines(js(summary_obj), file.path(out_dir, "summary.json"))

# ---------------------------------------------------------------- print
cat(sprintf("analysis set: %d patients, %d deaths, %d genes (%d expression samples; dropped %d no clinical, %d missing OS)\n",
            n, sum(event), G, n_expr_samples, drop_no_patient, drop_no_os))
cat(sprintf("duplicate expression profiles found: %d\n", dup_pairs))
cat(sprintf("Cox fitter warnings: %d (%s)\n", cox_warnings$n, paste(sort(cox_warnings$msgs), collapse = "; ")))
cat(sprintf("meta-gene (prolif-seeded): %d genes; alone HR %.3f p %s | prolif11 alone HR %.3f p %s | PCNA-seeded alone HR %.3f p %s (overlap %d)\n",
            n_meta, meta_alone[["hr"]], fmt(meta_alone[["p"]]), p11_alone[["hr"]], fmt(p11_alone[["p"]]),
            pcna_alone[["hr"]], fmt(pcna_alone[["p"]]), length(intersect(meta_idx, pcna_idx))))
cat("\nshare of random signatures with Cox p < 0.05\n")
print(by_size[, .(size, draws, pc1 = share_p05_pc1, pc1_adj_meta = share_p05_pc1_adj_meta,
                  pc1_adj_p11 = share_p05_pc1_adj_prolif11, pc1_adj_pcna = share_p05_pc1_adj_pcna, meanz = share_p05_meanz,
                  meanz_adj = share_p05_meanz_adj_meta, permuted = share_p05_permuted,
                  dss = share_p05_dss, dss_adj = share_p05_dss_adj_meta,
                  adj_meta_age = share_p05_pc1_adj_meta_age)])
cat("\npublished signatures\n")
for (nm in names(pub)) {
  q <- pub[[nm]]
  if (q$n_genes_used == 0L) { cat(sprintf("  %-28s no genes found\n", nm)); next }
  cat(sprintf("  %-28s genes %d/%d  p %s  p_adj %s (prolif11 %s)  share random(same size) p<=published %s  (adj %s)\n",
              nm, q$n_genes_used, q$n_genes_listed, fmt(q$p_pc1), fmt(q$p_pc1_adj_meta), fmt(q$p_pc1_adj_prolif11),
              fmt(q$share_random_same_size_p_le_published), fmt(q$share_random_same_size_p_le_published_adj)))
  if (length(q$missing)) cat("    missing:", paste(q$missing, collapse = ","), "\n")
}
