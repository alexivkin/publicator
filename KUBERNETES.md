# Running Publicator on Kubernetes

Instructions below assume GKE, with DNS is managed by AWS Route53 and Istio with cert-manager and SDS are the ingress points.

Create a DNS record for it. Note that the list below is specific to how GKE names clusters

```bash
export INGRESS_FQDN=[external domain name]

CLUSTER_NAME=$(kubectl config current-context)
carr=(${CLUSTER_NAME//_/ }) # exploiting the fact that the GKE cluster name contains what we need
export CLUSTER=${carr[3]}
export ZONE=${carr[2]}
export REGION=${ZONE%-*} # remove shortest match to -* from the end
export PROJECT_ID=${carr[1]}

export GATEWAY_NAME=$CLUSTER-gateway
export GATEWAY_IP=$(gcloud compute addresses describe $GATEWAY_NAME --project $PROJECT_ID --region $REGION --format json | jq -r .address)
export INGRESS_ZONE_ID=$(aws route53 list-hosted-zones | jq -r '.HostedZones[] | select(.Name=="'${INGRESS_FQDN#*.}'.") | .Id' | sed 's:/.*/::')
aws route53 change-resource-record-sets --hosted-zone-id $INGRESS_ZONE_ID --change-batch '{"Comment":"add '$id'","Changes":[{"Action":"CREATE","ResourceRecordSet":{"Name":"'$INGRESS_FQDN'","Type":"A","TTL":300,"ResourceRecords":[{"Value":"'$GATEWAY_IP'"}]}}]}'
aws route53 change-resource-record-sets --hosted-zone-id $INGRESS_ZONE_ID --change-batch '{"Comment":"add '$id'","Changes":[{"Action":"CREATE","ResourceRecordSet":{"Name":"'v$INGRESS_FQDN'","Type":"A","TTL":300,"ResourceRecords":[{"Value":"'$GATEWAY_IP'"}]}}]}'
```

The last step is repeated with a "v" in front of the name to create the preview site

Create the config.json and firebase.json. Use config.sample.json for reference and firebase documentation. Then inject them into the cluster

        kubectl create secret generic publicator --from-file=config.json=./[dev|stage|prod]-config.json

Copy the following config files to the volume mount: `firebase.json` `firebase.schema.json` `scraper.json` `scraper.schema.json`

        find ../superstatic/ -name *.json -exec kubectl cp {} publicator-[id_here]:/publicator/superstatic/ -c publicator \;

Deploy

        envsubst < publicator.yaml | kubectl apply -f -

Request Letsencrypt certificate. Use request-staging-certs.yaml or request-prod-certs.yaml. Note the "s" at the end - you're getting two certs

        envsubst < pub-request-[staging|prod]-cert.yaml | kubectl apply -f -

Grab the certificate and wait for it to be provisioned before adding new gateways to avoid bootstrapping issues. I.e if HTTP to HTTPS redirect is enabled, HTTPS will need to provide self-signed certs for ACME to connect to it to get the verification file.

        kubectl describe certificate -n istio-system  | grep Reason:

Should say "Ready". Now add the gateway servers. It will do 4 patches total for two hosts

        kubectl patch gateway main-gateway --type json  -p "$(envsubst < pub-patch-gateway.json)"

## How to

### How to patch existing deployment

Recover environment variables and patch. Deployment will be restarted.

        export WP_DB_PWD=$(kubectl get secret wp-db -o json | jq -r '.data.password')
        export INGRESS_FQDN=$(k get virtualservice/wordpress  -o json | jq -r '.spec.hosts[0]')
        envsubst < wordpress.yaml | kubectl apply -f -

### How to open an extra port in the istio gateway

        kubectl -n istio-system patch svc istio-ingressgateway --type=json -p='[{"op": "add","path": "/spec/ports/-","value": {"name":"preview","nodePort":31474,"port":3474,"protocol":"TCP","targetPort":3474}}]' --dry-run=true -o yaml | kubectl apply -f -

## How to create secret from command line

       kubectl create secret generic wp-db --from-literal=password="$WP_DB_PWD"
