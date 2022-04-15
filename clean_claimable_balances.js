const HORIZON_URL = 'https://horizon.stellar.org'
const STELLAR_NETWORK = 'PUBLIC';

secret = ""

(async () => {

    const server = new StellarSdk.Server(HORIZON_URL);

    const keypair = StellarSdk.Keypair.fromSecret(secret)

    const publicKey = keypair.publicKey()
    const account = await server.loadAccount(publicKey);

    var claimableBalancesResp = await server.claimableBalances().claimant(publicKey).limit(200).call();

    console.log(claimableBalancesResp)

    let claimableBalances = claimableBalancesResp.records

    while (claimableBalances.length == 200) {
        claimableBalancesResp = await server.claimableBalances().claimant(publicKey).limit(200).call();
        claimableBalances = claimableBalances.concat(claimableBalancesResp.records)
    }

    console.log("You've got " + claimableBalances.length + " claimable balances.")

    const fee = await getFee(server);

    let tx = new StellarSdk.TransactionBuilder(account, {
        fee,
        networkPassphrase: StellarSdk.Networks[STELLAR_NETWORK]
    });

    // claimableBalances = [claimableBalances[0], claimableBalances[1]];

    let removed_claimable_balances_count = 0

    const max_balances_per_tx = 25;

    for (let i = 0; i < Math.ceil(claimableBalances.length / max_balances_per_tx); i++) {

        batch_from_i = i * max_balances_per_tx
        batch_to_i = (i + 1) * max_balances_per_tx

        for (const claimableBalance of claimableBalances.slice(batch_from_i, batch_to_i)) {
            const balanceId = claimableBalance.id
            const amount = claimableBalance.amount
            const [code, issuer] = claimableBalance.asset.split(':')

            const is_claimable = _is_claimable(claimableBalance, publicKey)

            console.log(claimableBalance.amount, code, issuer)

            console.log("is_claimable:", is_claimable)

            if (!is_claimable) {
                continue
            }

            removed_claimable_balances_count += 1


            balanceAsset = new StellarSdk.Asset(code, issuer)


            const strictSendPathsResp = await server.strictSendPaths(
                sourceAsset=balanceAsset,
                sourceAmount=amount,
                destination=[StellarSdk.Asset.native(),]
            ).limit(1).call()

            const path = strictSendPathsResp.records[0]
            console.log(path)
            console.log("path.destination_amount:", path.destination_amount)

            tx.addOperation(StellarSdk.Operation.changeTrust({
                source: publicKey,
                asset: balanceAsset
            }));

            tx.addOperation(StellarSdk.Operation.claimClaimableBalance({
                source: publicKey,
                balanceId: balanceId
            }));

            if (parseFloat(path.destination_amount) > 0.0000000) {

                console.log(path.path)

                let pathInput = [];

                for (const assetDict of path.path) {
                    console.log(assetDict)
                    if (assetDict.asset_type == "native") {
                        pathInput.push(StellarSdk.Asset.native())
                    } else {
                        const asset_code = assetDict.asset_code;
                        const asset_issuer = assetDict.asset_issuer;
                        console.log(asset_code, asset_issuer)
                        pathInput.push(new StellarSdk.Asset(asset_code, asset_issuer))
                    }
                }

                tx.addOperation(StellarSdk.Operation.pathPaymentStrictSend({
                    sendAsset: balanceAsset,
                    sendAmount: amount,
                    destination: publicKey,
                    destAsset: StellarSdk.Asset.native(),
                    destMin: "0.0000001",
                    path: pathInput,
                    // source: publicKey
                }));



            } else {

                tx.addOperation(Operation.payment({
                    source: publicKey,
                    destination: issuer,
                    asset: balanceAsset,
                    amount: amount
                }));

            }

            tx.addOperation(StellarSdk.Operation.changeTrust({
                source: publicKey,
                asset: balanceAsset,
                limit: "0"
            }));

        }

        if (removed_claimable_balances_count > 0) {
            tx = tx.setTimeout(30).build();
            tx.sign(keypair);

            console.log(tx.toXDR())


            try {
                const txResult = await server.submitTransaction(tx);
                console.log(txResult)
            } catch (e) {
                console.log('An error has occured:');
                console.log(e);
                // console.log(e.response.data.extras.result_codes);
            }
        }
    }

    //console.log(claimableBalances)



})()

function _is_claimable(claimableBalance, claimantPublicKey) {
    var predicate;
    if (claimableBalance.claimants[0].destination == claimantPublicKey) {
        predicate = claimableBalance.claimants[0].predicate
    } else if (claimableBalance.claimants[1].destination == claimantPublicKey) {
        predicate = claimableBalance.claimants[1].predicate
    }

    console.log("predicate:", predicate)

    if ("unconditional" in predicate) {
        console.log("unconditional:", predicate.unconditional)
        return predicate.unconditional
    } else if ("abs_before_epoch" in predicate) {
        const current_timestamp = Math.floor(Date.now()/1000)
        console.log("abs_before_epoch:", current_timestamp < predicate.abs_before_epoch)
        return current_timestamp < predicate.abs_before_epoch
    }
}

async function getFee(server) {
  return server
  .feeStats()
  .then((feeStats) => feeStats?.fee_charged?.max || 100000)
  .catch(() => 100000)
};
