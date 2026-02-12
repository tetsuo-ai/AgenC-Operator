//! Stub replacement for solana-secp256r1-program that removes the OpenSSL
//! dependency. Our app never calls secp256r1 precompile verification directly;
//! this crate is only pulled in transitively by solana-sdk.

use bytemuck::{Pod, Zeroable};
pub use solana_sdk_ids::secp256r1_program::{check_id, id, ID};

#[derive(Default, Debug, Copy, Clone, Zeroable, Pod, Eq, PartialEq)]
#[repr(C)]
pub struct Secp256r1SignatureOffsets {
    pub signature_offset: u16,
    pub signature_instruction_index: u16,
    pub public_key_offset: u16,
    pub public_key_instruction_index: u16,
    pub message_data_offset: u16,
    pub message_data_size: u16,
    pub message_instruction_index: u16,
}

use solana_precompile_error::PrecompileError;

pub const COMPRESSED_PUBKEY_SERIALIZED_SIZE: usize = 33;
pub const SIGNATURE_SERIALIZED_SIZE: usize = 64;
pub const SIGNATURE_OFFSETS_SERIALIZED_SIZE: usize = 14;
pub const SIGNATURE_OFFSETS_START: usize = 2;
pub const DATA_START: usize = SIGNATURE_OFFSETS_SERIALIZED_SIZE + SIGNATURE_OFFSETS_START;

#[deprecated(
    since = "2.2.4",
    note = "Use agave_precompiles::secp256r1::verify instead"
)]
#[allow(deprecated)]
pub fn verify(
    _data: &[u8],
    _instruction_datas: &[&[u8]],
    _feature_set: &solana_feature_set::FeatureSet,
) -> Result<(), PrecompileError> {
    Err(PrecompileError::InvalidSignature)
}
