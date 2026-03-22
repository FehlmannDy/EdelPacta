#![cfg_attr(target_arch = "wasm32", no_std)]

#[cfg(not(target_arch = "wasm32"))]
extern crate std;

use xrpl_wasm_stdlib::core::current_tx::escrow_finish;
use xrpl_wasm_stdlib::core::current_tx::traits::TransactionCommonFields;
use xrpl_wasm_stdlib::core::keylets::credential_keylet;
use xrpl_wasm_stdlib::core::ledger_objects::current_escrow;
use xrpl_wasm_stdlib::core::ledger_objects::traits::CurrentEscrowFields;
use xrpl_wasm_stdlib::core::locator::Locator;
use xrpl_wasm_stdlib::core::types::account_id::AccountID;
use xrpl_wasm_stdlib::core::types::nft::{NFT_ID_SIZE, NFToken};
use xrpl_wasm_stdlib::host::get_tx_nested_field;
use xrpl_wasm_stdlib::host::trace::{trace_data, trace_num, DataRepr};
use xrpl_wasm_stdlib::host::{cache_ledger_obj, check_sig, Result::Err, Result::Ok};
use xrpl_wasm_stdlib::r_address;
use xrpl_wasm_stdlib::sfield;
use xrpl_wasm_stdlib::types::{ContractData, XRPL_CONTRACT_DATA_SIZE};

// ─── CONFIG ───────────────────────────────────────────────────────────────────

/// Oracle — seul wallet backend autorisé à soumettre EscrowFinish
const NOTARY_ACCOUNT: [u8; 20] = r_address!("raW1qTXwu1qDaEzW1cKmMCn8Q7MuvEHTVK");

/// Émetteur du credential KYC — même wallet Oracle
const KYC_ISSUER: [u8; 20] = r_address!("raW1qTXwu1qDaEzW1cKmMCn8Q7MuvEHTVK");

// ─── Point d'entrée ────────────────────────────────────────────────────────────
//
// Scénario : vente immobilière
//   Bob    = Vendeur  (possède le NFT = titre de propriété, recevra les XRP)
//   Alice  = Acheteur (a créé l'escrow avec ses XRP, recevra le NFT)
//   Notaire = tiers légal (soumet EscrowFinish, signe le NFT ID)
//   Oracle  = tiers KYC/eIDAS (signe aussi le NFT ID de façon indépendante)
//
// EscrowCreate  : Account=Alice, Destination=Bob, Amount=10 XRP
// EscrowFinish  : Account=Notaire
//
// Memos du EscrowFinish :
//   Memo[0] : NFT_ID       — NFT ID de Bob (32 bytes)
//   Memo[1] : NOTARY_SIG   — Signature DER du Notaire sur NFT_ID
//   Memo[2] : NOTARY_PUBKEY— Clé publique du Notaire (33 bytes secp256k1)
//   Memo[3] : ORACLE_SIG   — Signature DER de l'Oracle sur NFT_ID
//   Memo[4] : ORACLE_PUBKEY— Clé publique de l'Oracle (33 bytes secp256k1)
//   Memo[5] : BUYER_ADDR   — AccountID de l'acheteur Alice (20 bytes)
//
// Vérifications STRICTES (return 0 = escrow bloqué si l'une échoue) :
//   [1] Notaire  — seul rESx65V... peut soumettre EscrowFinish
//   [2] KYC Bob  — credential KYC_OK on-chain émis par le Notaire
//   [3] NFT Alice — Alice (acheteur) possède déjà le NFT au moment du finish
//   [4] Signature Notaire  — check_sig secp256k1 sur NFT_ID
//   [5] Signature Oracle   — check_sig secp256k1 sur NFT_ID

#[unsafe(no_mangle)]
pub extern "C" fn finish() -> i32 {

    // ── Lecture des 6 Memos ───────────────────────────────────────────────

    macro_rules! read_memo {
        ($idx:expr) => {{
            let mut buf: ContractData = [0; XRPL_CONTRACT_DATA_SIZE];
            let mut loc = Locator::new();
            loc.pack(sfield::Memos);
            loc.pack($idx);
            loc.pack(sfield::MemoData);
            let rc = unsafe {
                get_tx_nested_field(loc.as_ptr(), loc.num_packed_bytes(), buf.as_mut_ptr(), buf.len())
            };
            (buf, rc)
        }};
    }

    let (memo0, rc0) = read_memo!(0);  // NFT_ID
    let (memo1, rc1) = read_memo!(1);  // NOTARY_SIG
    let (memo2, rc2) = read_memo!(2);  // NOTARY_PUBKEY
    let (memo3, rc3) = read_memo!(3);  // ORACLE_SIG
    let (memo4, rc4) = read_memo!(4);  // ORACLE_PUBKEY
    let (memo5, rc5) = read_memo!(5);  // BUYER_ADDR (20 bytes)

    // ── NFT ID (Memo[0]) ──────────────────────────────────────────────────
    if rc0 < 32 {
        let _ = trace_num("ERR:MEMO0_NFT_ID rc=", rc0 as i64);
        return 0;
    }
    let nft_id_bytes: [u8; NFT_ID_SIZE] = match memo0[0..32].try_into() {
        core::result::Result::Ok(v) => v,
        core::result::Result::Err(_) => return 0,
    };
    let nft_token = NFToken::new(nft_id_bytes);
    let _ = trace_data("NFT_ID:", nft_token.as_bytes(), DataRepr::AsHex);

    // ── [1] Vérification du Notaire ───────────────────────────────────────
    let tx = escrow_finish::get_current_escrow_finish();
    match tx.get_account() {
        Ok(submitter) => {
            if submitter.0 == NOTARY_ACCOUNT {
                let _ = trace_data("OK:NOTAIRE", &[], DataRepr::AsHex);
            } else {
                let _ = trace_data("ERR:NOTAIRE_INCONNU", &submitter.0, DataRepr::AsHex);
                return 0;
            }
        }
        Err(e) => {
            let _ = trace_num("ERR:NOTAIRE_ERR", e.code() as i64);
            return 0;
        }
    }

    // ── Récupération de l'adresse de Bob (destination de l'escrow) ────────
    let bob = match current_escrow::get_current_escrow().get_destination() {
        Ok(addr) => addr,
        Err(e) => {
            let _ = trace_num("ERR:BOB_ADDR_ERR", e.code() as i64);
            return 0;
        }
    };

    // ── [2] KYC Bob — credential on-chain ─────────────────────────────────
    match credential_keylet(&bob, &AccountID(KYC_ISSUER), b"SWIYU_KYC") {
        Ok(keylet) => {
            let slot = unsafe { cache_ledger_obj(keylet.as_ptr(), keylet.len(), 0) };
            if slot >= 0 {
                let _ = trace_data("OK:KYC_BOB", &[], DataRepr::AsHex);
            } else {
                let _ = trace_data("ERR:KYC_ABSENT", &[], DataRepr::AsHex);
                return 0;
            }
        }
        Err(e) => {
            let _ = trace_num("ERR:KYC_KEYLET_ERR", e.code() as i64);
            return 0;
        }
    }

    // ── [3] Alice (acheteur) possède déjà le NFT ─────────────────────────
    if rc5 != 20 {
        let _ = trace_data("ERR:MEMO5_BUYER_ADDR_ABSENT", &[], DataRepr::AsHex);
        return 0;
    }
    let alice_bytes: [u8; 20] = match memo5[0..20].try_into() {
        core::result::Result::Ok(v) => v,
        core::result::Result::Err(_) => return 0,
    };
    let alice = AccountID(alice_bytes);
    match nft_token.uri(&alice) {
        Ok(_uri) => {
            let _ = trace_data("OK:NFT_ALICE", &[], DataRepr::AsHex);
        }
        Err(e) => {
            let _ = trace_num("ERR:NFT_ABSENT rc=", e.code() as i64);
            return 0;
        }
    }

    // ── [4] Signature cryptographique du Notaire ──────────────────────────
    if rc1 <= 0 || rc2 != 33 {
        let _ = trace_data("ERR:MEMO12_NOTARY_SIG_ABSENT", &[], DataRepr::AsHex);
        return 0;
    }
    {
        let sig_len = rc1 as usize;
        let rc_check = unsafe {
            check_sig(
                nft_id_bytes.as_ptr(), nft_id_bytes.len(),
                memo1.as_ptr(), sig_len,
                memo2.as_ptr(), 33,
            )
        };
        if rc_check == 1 {
            let _ = trace_data("OK:SIG_NOTAIRE", &[], DataRepr::AsHex);
        } else {
            let _ = trace_num("ERR:SIG_NOTAIRE_INVALIDE rc=", rc_check as i64);
            return 0;
        }
    }

    // ── [5] Signature cryptographique de l'Oracle ─────────────────────────
    if rc3 <= 0 || rc4 != 33 {
        let _ = trace_data("ERR:MEMO34_ORACLE_SIG_ABSENT", &[], DataRepr::AsHex);
        return 0;
    }
    {
        let sig_len = rc3 as usize;
        let rc_check = unsafe {
            check_sig(
                nft_id_bytes.as_ptr(), nft_id_bytes.len(),
                memo3.as_ptr(), sig_len,
                memo4.as_ptr(), 33,
            )
        };
        if rc_check == 1 {
            let _ = trace_data("OK:SIG_ORACLE", &[], DataRepr::AsHex);
        } else {
            let _ = trace_num("ERR:SIG_ORACLE_INVALIDE rc=", rc_check as i64);
            return 0;
        }
    }

    let _ = trace_data("OK:ESCROW_SETTLED", &[], DataRepr::AsHex);
    1
}
