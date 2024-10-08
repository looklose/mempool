import { Injectable } from '@angular/core';
import { catchError, forkJoin, map, Observable, of, switchMap, tap } from 'rxjs';
import { Inscription } from '../components/ord-data/ord-data.component';
import { Transaction } from '../interfaces/electrs.interface';
import { getNextInscriptionMark, hexToBytes, extractInscriptionData } from '../shared/ord/inscription.utils';
import { decipherRunestone, Runestone, Etching, UNCOMMON_GOODS } from '../shared/ord/rune.utils';
import { ElectrsApiService } from './electrs-api.service';


@Injectable({
  providedIn: 'root'
})
export class OrdApiService {

  constructor(
    private electrsApiService: ElectrsApiService,
  ) { }

  decodeRunestone$(tx: Transaction): Observable<{ runestone: Runestone, runeInfo: { [id: string]: { etching: Etching; txid: string; } } }> {
    const runestone = decipherRunestone(tx);
    const runeInfo: { [id: string]: { etching: Etching; txid: string; } } = {};
    const runesToFetch: Set<string> = new Set();

    if (runestone) {
      if (runestone.mint) {
        if (runestone.mint.toString() === '1:0') {
          runeInfo[runestone.mint.toString()] = { etching: UNCOMMON_GOODS, txid: '0000000000000000000000000000000000000000000000000000000000000000' };
        } else {
          runesToFetch.add(runestone.mint.toString());
        }
      }

      if (runestone.edicts.length) {
        runestone.edicts.forEach(edict => {
          runesToFetch.add(edict.id.toString());
        });
      }

      if (runesToFetch.size) {
        const runeEtchingObservables = Array.from(runesToFetch).map(runeId => {
          return this.getEtchingFromRuneId$(runeId).pipe(
            tap(etching => {
              if (etching) {
                runeInfo[runeId] = etching;
              }
            })
          );
        });

        return forkJoin(runeEtchingObservables).pipe(
          map(() => {
            return { runestone: runestone, runeInfo };
          })
        );
      }
      return of({ runestone: runestone, runeInfo });
    } else {
      return of({ runestone: null, runeInfo: {} });
    }
  }

  // Get etching from runeId by looking up the transaction that etched the rune
  getEtchingFromRuneId$(runeId: string): Observable<{ etching: Etching; txid: string; }> {
    const [blockNumber, txIndex] = runeId.split(':');

    return this.electrsApiService.getBlockHashFromHeight$(parseInt(blockNumber)).pipe(
      switchMap(blockHash => this.electrsApiService.getBlockTxId$(blockHash, parseInt(txIndex))),
      switchMap(txId => this.electrsApiService.getTransaction$(txId)),
      switchMap(tx => {
        const runestone = decipherRunestone(tx);
        if (runestone) {
          const etching = runestone.etching;
          if (etching) {
            return of({ etching, txid: tx.txid });
          }
        }
        return of(null);
      }),
      catchError(() => of(null))
    );
  }

  decodeInscriptions(witness: string): Inscription[] | null {

    const inscriptions: Inscription[] = [];
    const raw = hexToBytes(witness);
    let startPosition = 0;

    while (true) {
      const pointer = getNextInscriptionMark(raw, startPosition);
      if (pointer === -1) break;

      const inscription = extractInscriptionData(raw, pointer);
      if (inscription) {
        inscriptions.push(inscription);
      }

      startPosition = pointer;
    }

    return inscriptions;
  }
}
